package engine

import (
	"strings"
	"testing"

	. "github.com/Bunny3th/easy-workflow/workflow/model"
)

func validProcess() Process {
	return Process{
		ProcessName: "请假",
		Source:      "办公系统",
		Nodes: []Node{
			{NodeID: "Start", NodeName: "开始", NodeType: RootNode, UserIDs: []string{"$starter"}},
			{NodeID: "Manager", NodeName: "主管", NodeType: TaskNode, PrevNodeIDs: []string{"Start"}, UserIDs: []string{"U1"}},
			{NodeID: "END", NodeName: "结束", NodeType: EndNode, PrevNodeIDs: []string{"Manager"}},
		},
	}
}

func TestValidateProcessValid(t *testing.T) {
	if err := ValidateProcess(validProcess()); err != nil {
		t.Fatalf("valid process rejected: %v", err)
	}
}

func TestValidateProcessInvalid(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*Process)
		want string
	}{
		{"no start", func(p *Process) { p.Nodes[0].NodeType = TaskNode }, "开始节点"},
		{"duplicate id", func(p *Process) { p.Nodes[1].NodeID = "Start" }, "重复"},
		{"task no user", func(p *Process) { p.Nodes[1].UserIDs = nil }, "未设置处理人"},
		{"task two outgoing", func(p *Process) {
			p.Nodes = append(p.Nodes, Node{NodeID: "END2", NodeType: EndNode, PrevNodeIDs: []string{"Manager"}})
		}, "只有一个下级"},
		{"unknown prev", func(p *Process) { p.Nodes[1].PrevNodeIDs = []string{"Nope"} }, "不存在"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := validProcess()
			c.mut(&p)
			err := ValidateProcess(p)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("got %v, want contains %q", err, c.want)
			}
		})
	}
}

func TestValidateProcessCycle(t *testing.T) {
	p := Process{
		ProcessName: "环", Source: "s",
		Nodes: []Node{
			{NodeID: "Start", NodeType: RootNode},
			{NodeID: "GW1", NodeType: GateWayNode, PrevNodeIDs: []string{"Start", "GW2"},
				GWConfig: HybridGateway{InevitableNodes: []string{"GW2"}}},
			{NodeID: "GW2", NodeType: GateWayNode, PrevNodeIDs: []string{"GW1"},
				GWConfig: HybridGateway{InevitableNodes: []string{"GW1", "END"}}},
			{NodeID: "END", NodeType: EndNode, PrevNodeIDs: []string{"GW2"}},
		},
	}
	if err := ValidateProcess(p); err == nil || !strings.Contains(err.Error(), "环") {
		t.Fatalf("got %v, want cycle error", err)
	}
}
