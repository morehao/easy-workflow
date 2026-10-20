package engine

import "testing"

func TestExpressionEvaluatorBasic(t *testing.T) {
	vars := map[string]string{"$days": "3", "$type": "annual", "$x": "2", "$one": "1"}
	cases := []struct {
		expr string
		want bool
	}{
		{"$days>=3", true},
		{"$days>3", false},
		{"$days>=3 && $type==\"annual\"", true},
		{"$days>=3 and $type=='personal'", false},
		{"not ($days<3)", true},
		{"($x+1)>2", true},
		{"true || false", true},
		{"1=1", true},
		{"$one<3", true},
		{"1!=1", false},
	}
	for _, c := range cases {
		got, err := ExpressionEvaluatorWithVars(c.expr, vars)
		if err != nil {
			t.Fatalf("%s: %v", c.expr, err)
		}
		if got != c.want {
			t.Fatalf("%s = %v, want %v", c.expr, got, c.want)
		}
	}
}

func TestExpressionEvaluatorRejectsInjectionAndUnknowns(t *testing.T) {
	vars := map[string]string{"$days": "1 OR 1=1"}
	bad := []string{
		"1=1; DROP TABLE proc_task",
		"$days>=3",
		"$missing>1",
		"foo(1)",
		"$days[0]=1",
		"$days>=3 ? true : false",
	}
	for _, expr := range bad {
		if _, err := ExpressionEvaluatorWithVars(expr, vars); err == nil {
			t.Fatalf("%s: expected error", expr)
		}
	}
}
