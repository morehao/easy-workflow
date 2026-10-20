package engine

import (
	"fmt"
	"strings"

	. "github.com/Bunny3th/easy-workflow/workflow/model"
)

// ValidateProcess 校验流程定义结构，防止非法图入库。
//
// 规则：
//   - 名称/来源非空；节点列表非空
//   - 恰好一个开始节点（RootNode），且没有上级
//   - 至少一个结束节点（EndNode），且没有下级
//   - NodeID 非空且唯一；上级节点必须存在
//   - 任务节点必须有处理人/角色/开始事件之一；任务节点只能有一个下级
//   - 网关必须至少一个下级，Conditions/InevitableNodes 必须指向存在节点，表达式不能为空
//   - 从开始节点可达所有节点；不允许环
func ValidateProcess(process Process) error {
	if strings.TrimSpace(process.ProcessName) == "" {
		return fmt.Errorf("流程名称不能为空")
	}
	if strings.TrimSpace(process.Source) == "" {
		return fmt.Errorf("流程来源不能为空")
	}
	if len(process.Nodes) == 0 {
		return fmt.Errorf("流程至少需要一个节点")
	}

	byID := make(map[string]Node, len(process.Nodes))
	starts := make([]string, 0, 1)
	ends := make([]string, 0, 1)
	for _, n := range process.Nodes {
		id := strings.TrimSpace(n.NodeID)
		if id == "" {
			return fmt.Errorf("存在 NodeID 为空的节点")
		}
		if _, ok := byID[id]; ok {
			return fmt.Errorf("节点ID重复：%s", id)
		}
		byID[id] = n
		switch n.NodeType {
		case RootNode:
			starts = append(starts, id)
		case EndNode:
			ends = append(ends, id)
		case TaskNode, GateWayNode:
		default:
			return fmt.Errorf("节点[%s]类型非法：%d", id, n.NodeType)
		}
	}
	if len(starts) != 1 {
		return fmt.Errorf("流程必须且只能有一个开始节点，当前 %d 个", len(starts))
	}
	if len(ends) == 0 {
		return fmt.Errorf("流程至少需要一个结束节点")
	}

	outgoing := make(map[string][]string, len(process.Nodes))
	for id := range byID {
		outgoing[id] = nil
	}
	for _, n := range process.Nodes {
		id := strings.TrimSpace(n.NodeID)
		for _, prev := range n.PrevNodeIDs {
			prev = strings.TrimSpace(prev)
			if prev == "" {
				continue
			}
			if _, ok := byID[prev]; !ok {
				return fmt.Errorf("节点[%s]的上级节点[%s]不存在", id, prev)
			}
			if prev == id {
				return fmt.Errorf("节点[%s]不能引用自身为上级", id)
			}
			outgoing[prev] = append(outgoing[prev], id)
		}
	}

	for _, n := range process.Nodes {
		id := strings.TrimSpace(n.NodeID)
		label := n.NodeName
		if label == "" {
			label = id
		}
		switch n.NodeType {
		case RootNode:
			if len(n.PrevNodeIDs) > 0 {
				return fmt.Errorf("开始节点[%s]不能有上级", label)
			}
			if len(outgoing[id]) == 0 {
				return fmt.Errorf("开始节点[%s]没有下级", label)
			}
		case EndNode:
			if len(outgoing[id]) > 0 {
				return fmt.Errorf("结束节点[%s]不能有下级", label)
			}
			if len(n.PrevNodeIDs) == 0 {
				return fmt.Errorf("结束节点[%s]没有上级", label)
			}
		case TaskNode:
			if len(n.UserIDs) == 0 && len(n.Roles) == 0 && len(n.NodeStartEvents) == 0 {
				return fmt.Errorf("任务节点[%s]未设置处理人/角色/开始事件", label)
			}
			switch n.ApproveMode {
			case "", "any", "all", "sequential", "percentage":
			default:
				return fmt.Errorf("任务节点[%s]审批模式非法：%s", label, n.ApproveMode)
			}
			if n.ApproveMode == "percentage" && (n.ApprovePercent < 1 || n.ApprovePercent > 100) {
				return fmt.Errorf("任务节点[%s]比例审批百分比必须在 1-100", label)
			}
			if len(outgoing[id]) != 1 {
				return fmt.Errorf("任务节点[%s]必须有且只有一个下级，当前 %d 个", label, len(outgoing[id]))
			}
		case GateWayNode:
			if len(outgoing[id]) == 0 {
				return fmt.Errorf("网关[%s]没有下级", label)
			}
			if len(n.GWConfig.Conditions) == 0 && len(n.GWConfig.InevitableNodes) == 0 {
				return fmt.Errorf("网关[%s]既没有条件分支也没有必然执行分支", label)
			}
			for _, c := range n.GWConfig.Conditions {
				if _, ok := byID[c.NodeID]; !ok {
					return fmt.Errorf("网关[%s]的条件分支指向不存在的节点[%s]", label, c.NodeID)
				}
				if strings.TrimSpace(c.Expression) == "" {
					return fmt.Errorf("网关[%s]存在空条件表达式", label)
				}
				if _, err := tokenizeExpression(c.Expression); err != nil {
					return fmt.Errorf("网关[%s]条件表达式非法：%v", label, err)
				}
			}
			for _, target := range n.GWConfig.InevitableNodes {
				if _, ok := byID[target]; !ok {
					return fmt.Errorf("网关[%s]的必然分支指向不存在的节点[%s]", label, target)
				}
			}
		}
	}

	// 从开始节点可达性
	visited := make(map[string]bool, len(byID))
	queue := []string{starts[0]}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if visited[cur] {
			continue
		}
		visited[cur] = true
		queue = append(queue, outgoing[cur]...)
	}
	for id := range byID {
		if !visited[id] {
			return fmt.Errorf("节点[%s]从开始节点不可达", id)
		}
	}

	// 环检测（Kahn）
	inDegree := make(map[string]int, len(byID))
	for id := range byID {
		inDegree[id] = 0
	}
	for _, targets := range outgoing {
		for _, t := range targets {
			inDegree[t]++
		}
	}
	q := make([]string, 0, len(byID))
	for id, d := range inDegree {
		if d == 0 {
			q = append(q, id)
		}
	}
	removed := 0
	for len(q) > 0 {
		cur := q[0]
		q = q[1:]
		removed++
		for _, t := range outgoing[cur] {
			inDegree[t]--
			if inDegree[t] == 0 {
				q = append(q, t)
			}
		}
	}
	if removed != len(byID) {
		return fmt.Errorf("流程定义存在环，引擎无法正常流转")
	}

	return nil
}
