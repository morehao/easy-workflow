/**
 * 前端 -> 后端 端到端联调验证（需要 MySQL + Go 后端 + Vite 代理都已启动）。
 *
 * 这个脚本回答两个关键问题：
 *   1. **设计器导出的流程定义 JSON，Go 引擎真的认吗？**
 *      它直接调用前端真实的转换函数 graphToProcess()，把结果原样 POST 给 /def/save。
 *   2. **同一个库里放多个流程，会不会互相串流程？**
 *      它故意创建两个节点ID完全相同的流程（都用 Start / Fill / END），
 *      分别发起、审批，验证各自只在自己的流程内流转。
 *      这是对引擎缺陷的回归测试：proc_execution 是所有流程共用的表，
 *      修复前的 TaskNextNode 与 TaskUpstreamNodeList 漏了 proc_id 过滤，
 *      导致 First() 按主键取到别的流程的同名节点。
 *
 * 前置条件：MySQL 已启动且库 easy_workflow 存在、Go 后端监听 :8180、Vite 监听 :5173。
 * 运行： npm run check:e2e
 */
import type LogicFlow from '@logicflow/core'
import { graphToProcess, validateProcess } from '../src/logicflow/convert'

const BASE = process.env.E2E_BASE || 'http://localhost:5173/process'
const SOURCE = '办公系统'
const STARTER = 'U0001'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}`)
    if (detail !== undefined) console.error('    实际:', JSON.stringify(detail, null, 2)?.slice(0, 700))
  }
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  opts: { params?: Record<string, unknown>; form?: Record<string, unknown> } = {},
): Promise<{ status: number; body: any }> {
  let url = BASE + path
  if (opts.params) {
    const usp = new URLSearchParams()
    Object.entries(opts.params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') usp.append(k, String(v))
    })
    url += '?' + usp.toString()
  }
  let body: string | undefined
  const headers: Record<string, string> = {}
  if (opts.form) {
    const usp = new URLSearchParams()
    Object.entries(opts.form).forEach(([k, v]) => {
      if (v !== undefined && v !== null) usp.append(k, String(v))
    })
    body = usp.toString()
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }
  const resp = await fetch(url, { method, headers, body })
  const text = await resp.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    /* 保留原始字符串 */
  }
  return { status: resp.status, body: parsed }
}

/** 构造一份和设计器画布等价的数据：开始 -> 填写申请单(U0001) -> 结束 */
function buildGraph(): LogicFlow.GraphConfigData {
  const node = (id: string, type: string, x: number, props: Record<string, unknown>) => ({
    id,
    type,
    x,
    y: 200,
    properties: {
      isCosigned: 0,
      nodeStartEvents: [],
      nodeEndEvents: [],
      taskFinishEvents: [],
      roles: [],
      ...props,
    },
  })
  return {
    nodes: [
      node('lf_node_0', 'wf-start', 120, { nodeId: 'Start', nodeName: '提交申请', userIds: ['$starter'] }),
      node('lf_node_1', 'wf-task', 380, { nodeId: 'Fill', nodeName: '填写申请单', userIds: [STARTER] }),
      node('lf_node_2', 'wf-end', 640, { nodeId: 'END', nodeName: 'END', userIds: [] }),
    ],
    edges: [
      { id: 'lf_edge_0', type: 'polyline', sourceNodeId: 'lf_node_0', targetNodeId: 'lf_node_1' },
      { id: 'lf_edge_1', type: 'polyline', sourceNodeId: 'lf_node_1', targetNodeId: 'lf_node_2' },
    ],
  }
}

/** 保存一个流程定义，返回它的 ID */
async function saveDef(name: string): Promise<number | null> {
  const procDef = graphToProcess(buildGraph(), { processName: name, source: SOURCE, revokeEvents: [] })
  const errors = validateProcess(procDef).filter((i) => i.level === 'error')
  check(`[${name}] 设计器校验无 error`, errors.length === 0, errors)
  const save = await call('POST', '/def/save', {
    form: { Resource: JSON.stringify(procDef), CreateUserID: STARTER },
  })
  check(`[${name}] POST /def/save 返回 200`, save.status === 200, save)
  const list = await call('GET', '/def/list', { params: { source: SOURCE } })
  const def = (list.body as any[])?.find((d) => d.Name === name)
  check(`[${name}] 出现在流程定义列表中`, !!def, list.body)
  return def ? Number(def.ID) : null
}

interface RunResult {
  instId: number
  taskId: number
}

/** 发起一个实例，走完「填写申请单」任务，返回关键信息 */
async function runInstance(defId: number, name: string): Promise<RunResult | null> {
  const start = await call('POST', '/inst/start', {
    form: {
      ProcessID: defId,
      BusinessID: `E2E-${name}`,
      Comment: '由前端设计器导出的定义发起',
      VariablesJson: JSON.stringify([{ Key: 'starter', Value: STARTER }]),
    },
  })
  check(`[${name}] POST /inst/start 返回实例ID`, start.status === 200 && start.body, start)
  const instId = Number(start.body)
  if (!instId) return null
  console.log(`    -> 实例ID = ${instId}`)

  const todo = await call('GET', '/task/todo', {
    params: { userid: STARTER, procname: '', asc: 'true', idx: 0, rows: 100 },
  })
  const mine = ((todo.body as any[]) || []).filter((t) => t.ProcInstID === instId)
  check(`[${name}] 「填写申请单」生成了待办`, mine.length === 1 && mine[0].NodeID === 'Fill', mine)
  if (!mine[0]) return null

  const task = mine[0]
  const action = await call('GET', '/task/action', { params: { taskid: task.TaskID } })
  check(`[${name}] /task/action 返回 CanPass=true`, action.body?.CanPass === true, action)

  // 自由驳回的上游节点必须只来自本流程（回归：修复前会串到别的流程）
  const upstream = await call('GET', '/task/upstream', { params: { taskid: task.TaskID } })
  const upstreamIds = ((upstream.body as any[]) || []).map((n) => n.NodeID).sort()
  check(
    `[${name}] /task/upstream 只返回本流程的上游节点`,
    upstream.status === 200 && JSON.stringify(upstreamIds) === '["Start"]',
    upstream.body,
  )

  const pass = await call('POST', '/task/pass', {
    form: {
      TaskID: task.TaskID,
      Comment: '通过',
      VariableJson: JSON.stringify([{ Key: 'k', Value: 'v' }]),
    },
  })
  check(`[${name}] POST /task/pass 审批通过`, pass.status === 200, pass)

  return { instId, taskId: task.TaskID }
}

async function main() {
  console.log('\n[1] 用前端转换函数生成流程定义 JSON 并保存')
  const nameA = '前端设计器联调流程-A'
  const nameB = '前端设计器联调流程-B'
  const defA = await saveDef(nameA)
  const defB = await saveDef(nameB)
  check('两个流程定义都保存成功', !!defA && !!defB, { defA, defB })
  if (!defA || !defB) return
  check('两个流程定义是不同的 ID', defA !== defB, { defA, defB })

  const a = await call('GET', '/def/get', { params: { id: defA } })
  const b = await call('GET', '/def/get', { params: { id: defB } })
  const idsA = a.body?.Nodes?.map((n: any) => n.NodeID).sort()
  const idsB = b.body?.Nodes?.map((n: any) => n.NodeID).sort()
  check(
    '两个流程故意使用了完全相同的节点ID（Start/Fill/END）',
    JSON.stringify(idsA) === '["END","Fill","Start"]' && JSON.stringify(idsB) === '["END","Fill","Start"]',
    { idsA, idsB },
  )

  console.log('\n[2] 分别发起并审批两个流程（回归：不得串流程）')
  const runA = await runInstance(defA, nameA)
  const runB = await runInstance(defB, nameB)
  if (runA && runB) {
    check('两个实例的 ID 不同', runA.instId !== runB.instId, { a: runA.instId, b: runB.instId })
  }

  console.log('\n[3] 验证两个实例各自独立完成')
  for (const [name, defId, run] of [
    [nameA, defA, runA],
    [nameB, defB, runB],
  ] as const) {
    if (!run) continue
    const mine = await call('GET', '/inst/start/by', { params: { userid: STARTER, idx: 0, rows: 100 } })
    const inst = ((mine.body as any[]) || []).find((i) => i.ProcInstID === run.instId)
    check(`[${name}] 实例已流转到结束并完成（Status=1）`, inst?.Status === 1, inst)
    check(`[${name}] 实例挂载在自己的流程定义下`, inst?.ProcID === defId, inst)

    const hist = await call('GET', '/inst/task_history', { params: { instid: run.instId } })
    const nodeIds = ((hist.body as any[]) || []).map((t) => t.NodeID)
    check(
      `[${name}] 任务历史只包含本流程节点`,
      nodeIds.length > 0 && nodeIds.every((n) => ['Start', 'Fill', 'END'].includes(n)),
      nodeIds,
    )
  }

  console.log('\n[4] 示例流程（员工请假）仍可正常运行')
  const list = await call('GET', '/def/list', { params: { source: SOURCE } })
  const leave = (list.body as any[])?.find((d) => d.Name === '员工请假')
  check('示例流程仍存在', !!leave, list.body?.map((d: any) => d.Name))
  if (leave) {
    const st = await call('POST', '/inst/start', {
      form: {
        ProcessID: leave.ID,
        BusinessID: 'E2E-LEAVE-AFTER',
        VariablesJson: JSON.stringify([
          { Key: 'starter', Value: 'U0009' },
          { Key: 'days', Value: '5' },
        ]),
      },
    })
    check('示例流程仍可发起（未被同名节点影响）', st.status === 200 && !!st.body, st)
    if (st.status === 200) {
      const todo = await call('GET', '/task/todo', {
        params: { userid: '张经理', procname: '', asc: 'true', idx: 0, rows: 100 },
      })
      const t = ((todo.body as any[]) || []).find((x) => x.ProcInstID === Number(st.body))
      check('示例流程的主管审批任务正常生成', !!t && t.NodeID === 'Manager', t)
    }
  }

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项\n`)
  if (failed) process.exitCode = 1
}

main().catch((e) => {
  console.error('\n联调失败（请确认后端 :8180 与 Vite :5173 都已启动）：', e)
  process.exitCode = 1
})
