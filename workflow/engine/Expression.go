package engine

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// ExpressionEvaluator 计算网关条件表达式（不访问数据库，杜绝 SQL 注入）。
// 兼容旧调用：没有变量环境时只支持字面量/布尔表达式。
func ExpressionEvaluator(expression string) (bool, error) {
	return ExpressionEvaluatorWithVars(expression, nil)
}

// ExpressionEvaluatorWithVars 计算带变量的条件表达式。
//
// 支持：
//   - 数字/字符串/布尔字面量：1、1.5、"annual"、'annual'、true、false
//   - 变量：$days、$type（值来自 proc_inst_variable，自动推断 number/bool/string）
//   - 比较：> >= < <= == != =（= 等价 ==）
//   - 逻辑：&& || !，以及 and/or/not
//   - 算术：+ - * / %（仅数字）
//   - 括号
//
// 不支持：函数调用、索引、属性访问、SQL、赋值、分号。遇到即报错。
func ExpressionEvaluatorWithVars(expression string, vars map[string]string) (bool, error) {
	tokens, err := tokenizeExpression(expression)
	if err != nil {
		return false, err
	}
	if len(tokens) == 0 {
		return false, fmt.Errorf("条件表达式为空")
	}
	p := &exprParser{tokens: tokens, vars: vars}
	v, err := p.parseOr()
	if err != nil {
		return false, err
	}
	if p.pos != len(p.tokens) {
		return false, fmt.Errorf("条件表达式存在多余内容: %q", p.tokens[p.pos])
	}
	return exprToBool(v), nil
}

type exprKind int

const (
	exprNumber exprKind = iota
	exprString
	exprBool
)

type exprValue struct {
	kind exprKind
	num  float64
	str  string
	bool bool
}

func numValue(n float64) exprValue { return exprValue{kind: exprNumber, num: n} }
func strValue(s string) exprValue  { return exprValue{kind: exprString, str: s} }
func boolValue(b bool) exprValue   { return exprValue{kind: exprBool, bool: b} }
func exprToBool(v exprValue) bool {
	switch v.kind {
	case exprBool:
		return v.bool
	case exprNumber:
		return v.num != 0
	case exprString:
		s := strings.TrimSpace(strings.ToLower(v.str))
		return s != "" && s != "false" && s != "0" && s != "no"
	default:
		return false
	}
}

func tokenizeExpression(s string) ([]string, error) {
	var tokens []string
	for i := 0; i < len(s); {
		c := s[i]
		if unicode.IsSpace(rune(c)) {
			i++
			continue
		}
		// 字符串
		if c == '\'' || c == '"' {
			quote := c
			i++
			var b strings.Builder
			closed := false
			for i < len(s) {
				if s[i] == '\\' && i+1 < len(s) {
					b.WriteByte(s[i+1])
					i += 2
					continue
				}
				if s[i] == quote {
					i++
					closed = true
					break
				}
				b.WriteByte(s[i])
				i++
			}
			if !closed {
				return nil, fmt.Errorf("字符串字面量未闭合")
			}
			// 用一个前缀区分字符串 token，避免与数字/标识符混淆
			tokens = append(tokens, "str:"+b.String())
			continue
		}
		// 数字
		if (c >= '0' && c <= '9') || (c == '.' && i+1 < len(s) && s[i+1] >= '0' && s[i+1] <= '9') {
			start := i
			dot := false
			for i < len(s) {
				if s[i] >= '0' && s[i] <= '9' {
					i++
					continue
				}
				if s[i] == '.' && !dot {
					dot = true
					i++
					continue
				}
				break
			}
			tokens = append(tokens, s[start:i])
			continue
		}
		// 标识符/变量
		if isExprIdentStart(c) {
			start := i
			i++
			for i < len(s) && isExprIdentPart(s[i]) {
				i++
			}
			word := s[start:i]
			lower := strings.ToLower(word)
			switch lower {
			case "and", "or", "not", "true", "false":
				tokens = append(tokens, lower)
			default:
				tokens = append(tokens, "var:"+word)
			}
			continue
		}
		// 双字符运算符
		if i+1 < len(s) {
			two := s[i : i+2]
			switch two {
			case "&&", "||", "==", "!=", ">=", "<=":
				tokens = append(tokens, two)
				i += 2
				continue
			}
		}
		// 单字符
		switch c {
		case '!', '>', '<', '=', '+', '-', '*', '/', '%', '(', ')':
			tokens = append(tokens, string(c))
			i++
		default:
			return nil, fmt.Errorf("条件表达式包含不支持的字符: %q", string(c))
		}
	}
	return tokens, nil
}

func isExprIdentStart(c byte) bool {
	return c == '$' || c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}
func isExprIdentPart(c byte) bool {
	return isExprIdentStart(c) || (c >= '0' && c <= '9')
}

type exprParser struct {
	tokens []string
	pos    int
	vars   map[string]string
}

func (p *exprParser) peek() string {
	if p.pos >= len(p.tokens) {
		return ""
	}
	return p.tokens[p.pos]
}

func (p *exprParser) take() string {
	t := p.peek()
	if p.pos < len(p.tokens) {
		p.pos++
	}
	return t
}

func (p *exprParser) parseOr() (exprValue, error) {
	left, err := p.parseAnd()
	if err != nil {
		return exprValue{}, err
	}
	for p.peek() == "||" || p.peek() == "or" {
		p.take()
		right, err := p.parseAnd()
		if err != nil {
			return exprValue{}, err
		}
		left = boolValue(exprToBool(left) || exprToBool(right))
	}
	return left, nil
}

func (p *exprParser) parseAnd() (exprValue, error) {
	left, err := p.parseNot()
	if err != nil {
		return exprValue{}, err
	}
	for p.peek() == "&&" || p.peek() == "and" {
		p.take()
		right, err := p.parseNot()
		if err != nil {
			return exprValue{}, err
		}
		left = boolValue(exprToBool(left) && exprToBool(right))
	}
	return left, nil
}

func (p *exprParser) parseNot() (exprValue, error) {
	if p.peek() == "!" || p.peek() == "not" {
		p.take()
		v, err := p.parseNot()
		if err != nil {
			return exprValue{}, err
		}
		return boolValue(!exprToBool(v)), nil
	}
	return p.parseComparison()
}

func (p *exprParser) parseComparison() (exprValue, error) {
	left, err := p.parseAdd()
	if err != nil {
		return exprValue{}, err
	}
	op := p.peek()
	switch op {
	case ">", ">=", "<", "<=", "==", "!=", "=":
		p.take()
		right, err := p.parseAdd()
		if err != nil {
			return exprValue{}, err
		}
		return compareExpr(left, op, right)
	default:
		return left, nil
	}
}

func (p *exprParser) parseAdd() (exprValue, error) {
	left, err := p.parseMul()
	if err != nil {
		return exprValue{}, err
	}
	for p.peek() == "+" || p.peek() == "-" {
		op := p.take()
		right, err := p.parseMul()
		if err != nil {
			return exprValue{}, err
		}
		if left.kind != exprNumber || right.kind != exprNumber {
			return exprValue{}, fmt.Errorf("算术运算只支持数字")
		}
		if op == "+" {
			left = numValue(left.num + right.num)
		} else {
			left = numValue(left.num - right.num)
		}
	}
	return left, nil
}

func (p *exprParser) parseMul() (exprValue, error) {
	left, err := p.parseUnary()
	if err != nil {
		return exprValue{}, err
	}
	for p.peek() == "*" || p.peek() == "/" || p.peek() == "%" {
		op := p.take()
		right, err := p.parseUnary()
		if err != nil {
			return exprValue{}, err
		}
		if left.kind != exprNumber || right.kind != exprNumber {
			return exprValue{}, fmt.Errorf("算术运算只支持数字")
		}
		switch op {
		case "*":
			left = numValue(left.num * right.num)
		case "/":
			if right.num == 0 {
				return exprValue{}, fmt.Errorf("除数不能为 0")
			}
			left = numValue(left.num / right.num)
		case "%":
			if right.num == 0 {
				return exprValue{}, fmt.Errorf("取模除数不能为 0")
			}
			left = numValue(float64(int64(left.num) % int64(right.num)))
		}
	}
	return left, nil
}

func (p *exprParser) parseUnary() (exprValue, error) {
	switch p.peek() {
	case "-":
		p.take()
		v, err := p.parseUnary()
		if err != nil {
			return exprValue{}, err
		}
		if v.kind != exprNumber {
			return exprValue{}, fmt.Errorf("负号只支持数字")
		}
		return numValue(-v.num), nil
	case "+":
		p.take()
		return p.parseUnary()
	default:
		return p.parsePrimary()
	}
}

func (p *exprParser) parsePrimary() (exprValue, error) {
	tok := p.take()
	if tok == "" {
		return exprValue{}, fmt.Errorf("条件表达式不完整")
	}
	if tok == "(" {
		v, err := p.parseOr()
		if err != nil {
			return exprValue{}, err
		}
		if p.take() != ")" {
			return exprValue{}, fmt.Errorf("缺少右括号")
		}
		return v, nil
	}
	if strings.HasPrefix(tok, "str:") {
		return strValue(strings.TrimPrefix(tok, "str:")), nil
	}
	if tok == "true" {
		return boolValue(true), nil
	}
	if tok == "false" {
		return boolValue(false), nil
	}
	if n, err := strconv.ParseFloat(tok, 64); err == nil {
		return numValue(n), nil
	}
	if strings.HasPrefix(tok, "var:") {
		name := strings.TrimPrefix(tok, "var:")
		raw, ok := p.vars[name]
		if !ok {
			return exprValue{}, fmt.Errorf("条件表达式引用了未定义变量 %s", name)
		}
		return parseExprVariable(raw), nil
	}
	return exprValue{}, fmt.Errorf("条件表达式包含不支持的内容: %s", tok)
}

func parseExprVariable(raw string) exprValue {
	raw = strings.TrimSpace(raw)
	// 先按数字解析，避免 "1"/"0" 被 strconv.ParseBool 当成 true/false。
	if n, err := strconv.ParseFloat(raw, 64); err == nil {
		return numValue(n)
	}
	lower := strings.ToLower(raw)
	if lower == "true" {
		return boolValue(true)
	}
	if lower == "false" {
		return boolValue(false)
	}
	return strValue(raw)
}

func compareExpr(left exprValue, op string, right exprValue) (exprValue, error) {
	if left.kind != right.kind {
		return exprValue{}, fmt.Errorf("比较两侧类型不一致: %v vs %v", left.kind, right.kind)
	}
	switch left.kind {
	case exprNumber:
		switch op {
		case ">":
			return boolValue(left.num > right.num), nil
		case ">=":
			return boolValue(left.num >= right.num), nil
		case "<":
			return boolValue(left.num < right.num), nil
		case "<=":
			return boolValue(left.num <= right.num), nil
		case "==", "=":
			return boolValue(left.num == right.num), nil
		case "!=":
			return boolValue(left.num != right.num), nil
		}
	case exprString:
		switch op {
		case "==", "=":
			return boolValue(left.str == right.str), nil
		case "!=":
			return boolValue(left.str != right.str), nil
		case ">", ">=", "<", "<=":
			return boolValue(compareStrings(left.str, right.str, op)), nil
		}
	case exprBool:
		switch op {
		case "==", "=":
			return boolValue(left.bool == right.bool), nil
		case "!=":
			return boolValue(left.bool != right.bool), nil
		}
	}
	return exprValue{}, fmt.Errorf("不支持的操作符: %s", op)
}

func compareStrings(a, b, op string) bool {
	switch op {
	case ">":
		return a > b
	case ">=":
		return a >= b
	case "<":
		return a < b
	case "<=":
		return a <= b
	}
	return false
}
