# easy-workflow
已完成大量内测工作,正式版已发布

## easy-workflow是什么  
这是一个用纯GO语言开发的简单易用工作流引擎,可以集成到GO项目中，也可以单独作为Web Api Server运行

## 它有什么功能
除了基本的流程处理，作者经过中国式流程设计的洗礼，所以它包含以下增强功能：  
1、支持自定义事件。目前支持4种事件，分别是:a、节点开始 b、节点结束 c、任务结束 d、流程撤销;    
2、支持会签。所谓会签，即节点由多人审核，全部通过才算通过，任意一人驳回即算驳回;   
3、混合网关。约等于activiti中排他、并行网关、包含网关的混合体，更好支持复杂流程;       
4、支持各种飞线跳转审批:如自由驳回功能，可以任意驳回到上游任何节点;也直接提交到上一个驳回我的节点;  
5、可自定义计划任务。  
以上种种，只为完成更多中国式需求。   
### 用一个故事讲述功能点  
故事背景:假设某流程包含A、B、C、D、E 共5个任务节点，E节点由老板审核。而老板比较任性(向来如此)。    
#### 1、自由驳回
正常情况下,老板要把流程打回到创建人A的方式应该是:驳回到D，D再驳回到C...最终打回到流程提交人A。    
但是老板有钱任性，想要直接打回到A。此时，可以使用“自由驳回”功能，满足老板直接驳回，不留情面的需求。     
#### 2、直接提交到上一个驳回我的节点
A被领导E直接驳回，于是按照领导指示做修改后重新提交，传统情况下。流程需要重新流过B、C、D几个主管。    
一次两次还好，奈何老板各种不满意各种驳回，每次都要主管们再审核一遍。这样不仅效率低，还影响主管领导对员工的情绪。      
老板发话：芝麻绿豆大的事，B、C、D不用再参合了，小A你改完直接提我这边吧！  
此时使用"直接提交到上一个驳回我的节点"，A直接提交到上次驳回他的E，皆大欢喜。  
#### 3、混合网关  
国内java开发者常用的activiti引擎中包含以下几种网关:    
1、ParallelGeteway:并行网关，网关中所有节点完成才可流向网关下一个节点;  
2、ExclusiveGateway:排他网关，多用作条件判断，比如满足条件A，则流向节点1；满足条件B，则流向节点2，只能两者选一;   
3、InclusiveGateway:包含网关，并行与排他的混合。  
**网关的本质是控制节点的走向、流转逻辑，从而实现更复杂的流程定义。**   
作者不喜欢把事情搞复杂，所以本项目中只有一种网关:混合网关,可视为activiti中排他、并行网关、包含网关的混合体。  
**简言之，这个流程引擎考虑国情，力求更好的满足多样化需求**
#### 4、事件  
事件可以用作通知、改变流程行为。举几个例子：  
a、节点开始事件可以用于解析节点中角色。流程引擎并不知道节点中“主管”角色到底是谁，此时必须使用开始事件从业务库中解析“主管”角色的用户ID;    
b、节点事件可用于通知，提醒各任务处理人;  
c、任务完成事件与节点事件的区别在于：一个节点可能有多个任务，节点开始与结束事件在节点生命周期中只会各运行一次。而任务事件在每个任务提交后都会触发。    
d、流程被撤销时也可触发事件。  
在示例代码中，使用任务完成事件改变了会签节点的行为，使原本需要3人全部通过的节点变成只要2人通过。   
#### 5、任务计划  
任务计划可以看作是事件的辅助，示例中演示了如何利用计划任务让特定用户的任务自动完成。     

## 开始使用  
Tips:作者强烈建议阅读example中代码示例。注释比代码多一向是作者的风格，基本看完example，即可知引擎使用方法。    

### 环境要求  
1、MySQL 8.0以上版本(支持CTE)   
2、需要1.18以上Go版本(支持泛型)  

### 下载  
方法一:  
在go.mod文件中添加  github.com/Bunny3th/easy-workflow 版本号    

方法二:    
go get github.com/Bunny3th/easy-workflow@版本号  

### 开启引擎  
```go
import "github.com/Bunny3th/easy-workflow/workflow/engine"

func DBConnConfig() {
	engine.DBConnConfigurator.DBConnectString = "数据库账号:密码@tcp(地址:端口)/数据库名称?charset=utf8mb4&parseTime=True&loc=Local"	
}

func main() {
   //开启工作流引擎
   engine.StartWorkFlow(DBConnConfig, false, nil)
}
```
StartWorkFlow方法：  
```go
func StartWorkFlow(DBConnConfigurator DataBaseConfigurator, ignoreEventError bool, EventStructs ...any)
```
传入参数定义
  + DBConnConfigurator:数据库连接配置器,完整配置func如下:
```go
  func DBConnConfig() {
     DBConnConfigurator.DBConnectString = "连接字符串"        //必须设置         数据库连接字符串
     DBConnConfigurator.MaxIdleConns=100                     //非必设,默认10    空闲连接池中连接的最大数量
     DBConnConfigurator.MaxOpenConns=200                     //非必设,默认100   打开数据库连接的最大数量
     DBConnConfigurator.ConnMaxLifetime=200                  //非必设,默认3600  连接可复用的最大时间（分钟）
     DBConnConfigurator.SlowThreshold=3                      //非必设,默认1     慢SQL阈值(秒)
     DBConnConfigurator.LogLevel=4                           //非必设,默认3     日志级别 1:Silent  2:Error 3:Warn 4:Info
     DBConnConfigurator.IgnoreRecordNotFoundError=false      //非必设,默认true  忽略ErrRecordNotFound（记录未找到）错误
     DBConnConfigurator.Colorful=false                       //非必设,默认true  使用彩色打印
  }
```
  + ignoreEventError：在事件执行时，是否忽略其报错。事件出错可能导致流程无法运行,此选项设置为true，则忽略事件出错，让流程继续  
  + EventStructs：作者使用反射运行事件方法，故需将事件方法“挂”在Struct上传入。若流程定义中无需运行事件，则直接传nil即可。事件代码示例:  
```go
//示例事件
type MyEvent struct{}

//节点结束事件
func (e *MyEvent) MyEvent_End(ProcessInstanceID int, CurrentNode *Node, PrevNode Node) error {
	//示例:在节点结束时打印信息
	processName, err := GetProcessNameByInstanceID(ProcessInstanceID)
	if err != nil {
		return err
	}
	log.Printf("--------流程[%s]节点[%s]结束-------", processName, CurrentNode.NodeName)
	return nil
}
```  
**注意事项**  
1、事件方法接收者必须是指针。如上示方法MyEvent_End,其方法接收者为*MyEvent  
2、StartWorkFlow传入事件Struct时，必须传入指针，如：StartWorkFlow(DBConnConfig,false,&MyEvent{})  
### 更多信息
**请查阅源码根目录下"EasyWorkFlow工作流引擎说明文档.pdf"文档**  

## 配套前端（本仓库新增）
本仓库在 `web/` 目录下提供了一套基于 [LogicFlow](https://github.com/didi/LogicFlow) 的前端，
直接对接上面的 `web_api` 接口，包含**流程设计器**、流程定义管理、实例中心、任务中心与**流程图进度回显**。

### 一条命令起前后端

```bash
make            # 启动后端 :8180 + 前端 :5173，Ctrl-C 一起停止
```

浏览器打开 <http://localhost:5173>（别用 `127.0.0.1`，dev server 只绑了 IPv6 回环）。
另开一个终端可以跑自检：

```bash
make check      # 25 + 29 + 32 项断言（纯前端转换 / 前后端联调 / 引擎流程语义）
```

`make` 会自动检查端口与数据库、首次运行自动 `npm install`，并把两端日志同时打到终端
（带 `[后端]` / `[前端]` 前缀）和 `logs/` 目录下。

### 全部 make 命令

```bash
make help       # 查看全部命令
```

| 命令 | 说明 |
| --- | --- |
| `make` / `make dev` | 一键启动前后端（默认目标） |
| `make backend` / `make frontend` | 只启动其中一端 |
| `make check` | 全部自检；也可用 `check-convert` / `check-e2e` / `check-engine` 单独跑 |
| `make status` / `make stop` | 查看状态 / 停掉占用端口的进程 |
| `make build` / `make typecheck` / `make setup` / `make clean` | 构建、类型检查、装依赖、清理 |
| `make db-up` / `make db-reset` / `make db-tables` | 启动 MySQL / 重建库 / 查看表与流程定义 |

连接信息可用变量覆盖，例如：

```bash
make dev DB_HOST=192.168.1.10 DB_PORT=3306 DB_USER=root DB_PASS=secret
```

### 不用 make 的手动方式

```bash
# 1. 准备 MySQL 8（引擎会自动建表，但不会建库）
docker run -d --name easy-workflow-mysql -e MYSQL_ROOT_PASSWORD=123456 \
  -e MYSQL_DATABASE=easy_workflow -e MYSQL_USER=goeasy -e MYSQL_PASSWORD='sNd%sLDjd*12' \
  -p 3306:3306 mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_general_ci

# 2. 启动引擎（监听 :8180，接口前缀 /process，首次启动会自动播种示例流程）
go run example/main.go

# 3. 启动前端（Vite 会把 /process 代理到 :8180）
cd web && npm install && npm run dev   # http://localhost:5173

# 4. 验证端到端联通（29 项断言，需上面三步都在运行）
cd web && npm run check:e2e
```

数据库连接默认指向本地，可用环境变量覆盖（`EASY_WORKFLOW_DSN` / `EASY_WORKFLOW_DB_HOST` /
`EASY_WORKFLOW_DB_USER` / `EASY_WORKFLOW_DB_PASS` / `EASY_WORKFLOW_DB_NAME` / `EASY_WORKFLOW_API_ADDR`）。

打开 <http://localhost:5173/defs/new?demo=1> 可直接载入内置的「员工请假」示例流程（含排他网关、并行网关、会签节点）。
详见 [web/README.md](web/README.md)。

> **顺带修复的引擎缺陷**：`proc_execution` 是所有流程共用的表，但 `TaskNextNode()` 与
> `TaskUpstreamNodeList()` 漏了 `proc_id` 过滤。只要同库的两个流程存在同名节点
> （例如都用 `Start` / `END`），B 流程的实例就会去 A 流程里找节点，发起实例直接报
> `ID为N的流程实例中不存在ID为xxx的节点`。也就是说**修复前一个库实际只能放一个流程定义**。
> 已给这两处补上 `proc_id` 过滤（共 4 行 SQL 条件），修复后同一个库可放任意多个流程、节点ID可重名。


### 聊聊天  
这个项目是去年为了解决实际需求，对比了几个开源go工作流，觉得都不满意而自己上手写的。最近陆陆续续有一部分同学加我微信咨询问题，能帮到一些小忙，还是挺欣慰的，算是为中国开源软件做了一点点贡献吧。  
  
6年前怀着一股热情，加入了一个创业团队做技术负责人，加班加点的干，想着努力，努力，我要做儿子的榜样。  
可是突然有一天，很多人都看到了，经历了，大量的裁员大量的失业。我不甘心，想着这是我创业的公司，这是我最后一家公司，我要干到退休，要找活路，要找业务。当时IT团队只剩下我和另一位元老同事，我们两人向老板建议，说要不做软件外包吧。  
要放以前肯定想，两个人怎么做外包？可是真到了生死关头，老板拉业务，同事做产品，我一个人搞全栈开发，还真的把接到手的两个项目做完了，交付了。  
那时我好高兴，我这个老兵还能作战呢！公司有新业务了！  
  
于是招人，搭团队，干呗！那阵子真是累，连着一个月驻场没回家，整个队伍都阳了一遍。我阳了以后窝在小旅馆里，靠着一碗猪脚黄豆汤撑过了两天，这辈子难忘。  
之后外包业务算是展开了。可是我也发现自己越来越颓了。      
外包要的是什么？要的是人力的堆砌，要的是加班加点，要的是尽量榨取员工的剩余价值。客户都是老板通过关系拉的，各种不能得罪，各种需求无法拒绝，加剧了以上所有问题。  
在这种代码农场里，我这样的人，还有什么用呢？和疲惫的程序员说你们要注意代码质量？和老板说客户要的有点急所以没法一个月交付？和客户说您的要求太奇葩，而且别老是张三提A李四提B行吗？  
甲方的要求变成了"50万的项目你们要给我做出500万的效果"（不开玩笑，真这么说过)，而老板的不满是我们的项目为什么迟迟不能交付。  
公司赚钱要有成本控制，可是很多的项目已经压缩到1个前端+1个后端就开干的程度。项目成本最大的原因是不能得罪下的需求失控。            
之前看不起外包项目代码质量，现在报应来了。这种极致的压迫下，能不出屎山么？  

公司难，老板难，都能理解，毕竟这么多年大家都难过来了。  
可我觉得当时为了求生存开展的自救，已经让公司变了味道。而且，也一天天的加深了疲惫，无能，无力。   
我不想为了自己多吃一口，给疲惫的孩子们熬鸡汤。他们入职的时候，我告诉他千里迢迢离开父母来到这里，希望能获得成长，让生活更好。现在他们的生活更好了么？  
我也理解老板，6年前他是意气风发的，现在他是焦虑的。    

现在的公司，每年也能从国企那边接一些单子，维持着生存。我也还能坐在办公室里，吹着空调，每个月能拿着一笔工资。很多人说，这样挺好，现在的环境，有一份工作就很不错了。    
我明白，他们说的是对的，在这个时候，能养家糊口才是最大的欣慰。  
可是我还是感到一种悲哀。为那些20多岁离家打拼的孩子们，为那些30多岁猝死的顶梁柱们，为像我一样40多岁已经被嫌弃的老兵们。  
中国为什么少有优秀的开源软件呢？这就是答案吧。     
 


