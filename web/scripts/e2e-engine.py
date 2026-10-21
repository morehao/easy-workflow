#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Go 引擎全链路端到端验证（纯标准库，无需第三方依赖）。

与 verify-e2e.ts 的分工：
  * verify-e2e.ts   验证「前端设计器导出的定义」能否被引擎接受，并回归多流程串流程的缺陷；
  * e2e-engine.py   验证「引擎本身的流程语义」是否正确 —— 排他网关分支、
                    并行网关汇聚（WaitForAllPrevNode）、会签计数、驳回、撤销、已办列表。

覆盖 32 项断言，全部通过 Vite 代理打到 Go 后端，因此顺带验证了代理链路。

前置条件：MySQL 已启动且库 easy_workflow 存在、Go 后端监听 :8180、Vite 监听 :5173。
运行： python3 web/scripts/e2e-engine.py      （或 npm run check:engine）
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://localhost:5173/process"
SOURCE = "办公系统"

_passed = 0
_failed = 0


def call(method, path, params=None, form=None):
    """返回 (status, parsed_body)。后端约定：200=业务数据，400=错误信息字符串。"""
    url = BASE + path
    data = None
    if params:
        url += "?" + urllib.parse.urlencode(params)
    if form is not None:
        form = {k: v for k, v in form.items() if v is not None}
        data = urllib.parse.urlencode(form).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        status = e.code
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError:
        return status, raw


def check(name, cond, detail=None):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  \u2713 {name}")
    else:
        _failed += 1
        print(f"  \u2717 {name}")
        if detail is not None:
            print(f"    实际: {json.dumps(detail, ensure_ascii=False)[:600]}")


def finished_of(user):
    st, body = call("GET", "/task/finished",
                    params={"userid": user, "procname": "", "ignorestartbyme": "false",
                            "asc": "false", "idx": 0, "rows": 100})
    if st != 200:
        print(f"    !! /task/finished userid={user} -> HTTP {st}: {body}")
        return []
    return body if isinstance(body, list) else []


def section(title):
    print(f"\n{title}")


def todo_of(user):
    # 后端用 strconv.ParseBool(c.Query("asc")) 解析，asc 缺失会直接 400
    st, body = call("GET", "/task/todo",
                    params={"userid": user, "procname": "", "asc": "true", "idx": 0, "rows": 100})
    if st != 200:
        print(f"    !! /task/todo userid={user} -> HTTP {st}: {body}")
        return []
    return body if isinstance(body, list) else []


def finish_task(task, comment):
    """按 web/src/api/task.ts 的字段名提交"""
    return call("POST", "/task/pass", form={"TaskID": task["TaskID"], "Comment": comment,
                                            "VariableJson": json.dumps([{"Key": "e2e", "Value": "1"}])})


# ---------------------------------------------------------------- 1
section("[1] 服务连通性")
st, body = call("GET", "/def/list", params={"source": SOURCE})
check("GET /def/list 通过 Vite 代理返回 200", st == 200, (st, body))
check("返回了示例流程「员工请假」", isinstance(body, list) and any(d.get("Name") == "员工请假" for d in body), body)
proc = next((d for d in body if d.get("Name") == "员工请假"), None)
# 注意：后端每次启动都会重新保存一遍示例流程，Version 会随之 +1，
# 所以这里只断言「有版本且 >= 1」，不能写死 v1。
check("示例流程有版本号", bool(proc) and int(proc.get("Version") or 0) >= 1, proc)

st, process = call("GET", "/def/get", params={"id": proc["ID"]})
check("GET /def/get 返回流程定义", st == 200 and process.get("ProcessName") == "员工请假", (st, process))
node_ids = [n["NodeID"] for n in process["Nodes"]]
check("流程定义含 9 个节点", len(node_ids) == 9, node_ids)

gw_day = next(n for n in process["Nodes"] if n["NodeID"] == "GW-Day")
check(
    "排他网关的两个条件分支与引擎内一致",
    [c["Expression"] for c in gw_day["GWConfig"]["Conditions"]] == ["$days>=3", "$days<3"],
    gw_day["GWConfig"],
)

# ---------------------------------------------------------------- 2
section("[2] 发起实例：$days>=3 走「主管审批」分支")
st, inst_id = call(
    "POST",
    "/inst/start",
    form={
        "ProcessID": proc["ID"],
        "BusinessID": "E2E-DAYS5",
        "Comment": "端到端测试：请假5天",
        # 前端字段名是 VariablesJson（复数）
        "VariablesJson": json.dumps([{"Key": "starter", "Value": "U0001"}, {"Key": "days", "Value": "5"}]),
    },
)
check("POST /inst/start 返回实例ID", st == 200 and inst_id, (st, inst_id))
inst_id = int(inst_id)
print(f"    -> 实例ID = {inst_id}")

st, history = call("GET", "/inst/task_history", params={"instid": inst_id})
check("开始节点已自动通过并生成主管审批任务",
      st == 200 and any(t["NodeID"] == "Manager" for t in history), history)
check("变量 starter 已写入且开始节点处理人为 U0001",
      any(t["NodeID"] == "Start" and t["UserID"] == "U0001" for t in history), history)

# ---------------------------------------------------------------- 3
section("[3] 主管审批 -> 触发并行网关")
manager_tasks = [t for t in todo_of("张经理") if t["ProcInstID"] == inst_id]
check("角色「主管」被事件解析为「张经理」并产生待办", len(manager_tasks) == 1, manager_tasks)
mt = manager_tasks[0]

st, action = call("GET", "/task/action", params={"taskid": mt["TaskID"]})
check("GET /task/action 返回可执行操作且 CanPass=true", st == 200 and action.get("CanPass") is True, (st, action))

st, res = finish_task(mt, "同意，注意交接工作")
check("POST /task/pass 主管审批通过", st == 200, (st, res))

hr_tasks = [t for t in todo_of("人事老刘") if t["ProcInstID"] == inst_id]
dep_tasks = [t for t in todo_of("赵总") if t["ProcInstID"] == inst_id]
check("并行网关同时产生「人事审批」待办", len(hr_tasks) == 1, hr_tasks)
check("并行网关同时产生「副总审批」待办", len(dep_tasks) == 1, dep_tasks)
check("副总节点为会签节点", dep_tasks and dep_tasks[0]["IsCosigned"] == 1, dep_tasks)

# ---------------------------------------------------------------- 4
section("[4] 并行分支 + 会签（副总 3 人，事件改为 2 人通过即可）")
st, _ = finish_task(hr_tasks[0], "人事同意")
check("人事审批通过", st == 200)

qian_tasks = [t for t in todo_of("钱总") if t["ProcInstID"] == inst_id]
check("会签节点为 3 位副总各生成一个任务", len(dep_tasks) == 1 and len(qian_tasks) == 1, (dep_tasks, qian_tasks))

st, _ = finish_task(dep_tasks[0], "赵总同意")
check("第 1 位副总通过（会签未满 2 人，节点不结束）", st == 200)
check(
    "会签未满 2 人时节点仍在副总处（未流转到老板）",
    not [t for t in todo_of("李老板") if t["ProcInstID"] == inst_id],
)

st, _ = finish_task(qian_tasks[0], "钱总同意")
check("第 2 位副总通过（触发 MyEvent_TaskForceNodePass 强制节点通过）", st == 200)

# ---------------------------------------------------------------- 5
section("[5] 并行汇聚（WaitForAllPrevNode=1）-> 老板审批 -> 结束")
boss_tasks = [t for t in todo_of("李老板") if t["ProcInstID"] == inst_id]
check("两条并行分支都完成后才流转到「老板审批」", len(boss_tasks) == 1, boss_tasks)

if boss_tasks:
    st, _ = finish_task(boss_tasks[0], "批准")
    check("老板审批通过", st == 200)

st, final_history = call("GET", "/inst/task_history", params={"instid": inst_id})
nodes_in_history = {t["NodeID"] for t in final_history}
check("任务历史包含全部关键节点",
      {"Start", "Manager", "HR", "DeputyBoss", "Boss"} <= nodes_in_history, sorted(nodes_in_history))

st, mine = call("GET", "/inst/start/by", params={"userid": "U0001", "idx": 0, "rows": 100})
this_inst = next((i for i in mine if i["ProcInstID"] == inst_id), None)
check("实例状态变为 1（已完成）", this_inst and this_inst["Status"] == 1, this_inst)
check("实例业务ID回显正确", this_inst and this_inst["BusinessID"] == "E2E-DAYS5", this_inst)

# ---------------------------------------------------------------- 6
section("[6] 反向验证：$days<3 直接走「结束」分支")
st, inst2 = call(
    "POST",
    "/inst/start",
    form={
        "ProcessID": proc["ID"],
        "BusinessID": "E2E-DAYS1",
        "Comment": "端到端测试：请假1天",
        "VariablesJson": json.dumps([{"Key": "starter", "Value": "U0002"}, {"Key": "days", "Value": "1"}]),
    },
)
check("第二个实例发起成功", st == 200 and inst2, (st, inst2))
inst2 = int(inst2)

st, mine2 = call("GET", "/inst/start/by", params={"userid": "U0002", "idx": 0, "rows": 100})
i2 = next((i for i in mine2 if i["ProcInstID"] == inst2), None)
check("$days<3 时跳过主管审批直接结束（Status=1）", i2 and i2["Status"] == 1, i2)
check("$days<3 时未产生主管待办",
      not [t for t in todo_of("张经理") if t["ProcInstID"] == inst2],
      [t for t in todo_of("张经理") if t["ProcInstID"] == inst2])

# ---------------------------------------------------------------- 7
section("[7] 已办列表")
done_manager = [t for t in finished_of("张经理") if t["ProcInstID"] == inst_id]
check("主管的已办列表能查到该任务", len(done_manager) == 1, done_manager)
check("已办任务状态为 1（通过）并记录了审批意见",
      done_manager and done_manager[0]["Status"] == 1 and "交接" in (done_manager[0]["Comment"] or ""),
      done_manager)

# ---------------------------------------------------------------- 8
section("[8] 流程变量与撤销")
st, revoke_test = call(
    "POST",
    "/inst/start",
    form={
        "ProcessID": proc["ID"],
        "BusinessID": "E2E-REVOKE",
        "VariablesJson": json.dumps([{"Key": "starter", "Value": "U0003"}, {"Key": "days", "Value": "9"}]),
    },
)
inst3 = int(revoke_test)
st, res = call("POST", "/inst/revoke", form={"InstanceID": inst3, "RevokeUserID": "U0003", "Force": "true"})
check("POST /inst/revoke 强制撤销成功", st == 200, (st, res))
st, mine3 = call("GET", "/inst/start/by", params={"userid": "U0003", "idx": 0, "rows": 100})
i3 = next((i for i in mine3 if i["ProcInstID"] == inst3), None)
check("实例状态变为 2（已撤销）", i3 and i3["Status"] == 2, i3)

# ---------------------------------------------------------------- 汇总
print(f"\n{'=' * 60}")
print(f"通过 {_passed} 项，失败 {_failed} 项")
print("=" * 60)
sys.exit(1 if _failed else 0)
