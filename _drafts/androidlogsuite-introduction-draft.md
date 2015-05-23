---
layout: post
category : androidlogsuite
tagline: "Structure of the code"
tags : []
---
{% include JB/setup %}

## Task驱动

当有一条ADB命令到来，会新建一个Task，这个Task会和Model关联。

Task可以理解为：从一条adb命令发出，到看到完整输出结果的过程。

Model可以理解为一个解析模型，对adb命令的返回结果进行解析操作，然后将解析结果图形化。

adb命令的返回结果就是日志，日志的种类是非常多，而且是没有一定的输出标准可循的。
所以Model设计得尽可能多的支持多的日志类型。

Task会交由TaskCenter管理。
TaskCenter的职责是什么呢？
它统管所有的Task。我们在通过命令行输入一条adb命令，实际上是连接到手机的adbd服务进程，
这其实就是一个socket连接。既然Task是发出命令并得到返回结果的过程，那么，一个Task就对应
到一个Socket连接。TaskCenter需要统一管理所有的Socket连接。

管理多个Socket连接，有两个模型：轮询阻塞等候模型，非阻塞通知模型。
TaskCenter就是采用的非阻塞通知模型，即Select。

## 解析模型

`androidlogsuite`的解析模型是基于XML配置的。

我们对adb命令大致分为两类：静态命令和动态命令。

- 静态命令。是指输入命令有一次性的完整输出。比如dumpsys这类命令，每次输入都会得到完整的输出。

- 动态命令。是指输入命令得到的输出会随着时间的推移持续性的更新。比如adb logcat命令，每次输入
都会得到实时的日志输出。

对于已有的日志文件，相当于我们已经拿到的adb命令的日志输出，解析之前，我们并不知道它是由哪些输入adb命令产出，
所以，已有日志文件的解析模型相当于一个大杂烩，我们把它定义为`文件解析模型`

### 配置文件

`androidlogsuite`通过ID来标注不同类型的解析模型。
譬如针对dumpsys meminfo命令，它的解析模型配置为：

    <model-config androidlogsuite:id="+dumpsys-meminfo" androidlogsuite:type="dumpsys" androidlogsuite:cmd="meminfo"  androidlogsuite:configfile="meminfo.xml" />

ID为dumpsys-meminfo; 类型为dumpsys，表示这是静态adb命令的解析模型; 实际指导完成解析的配置文件是meminfo.xml，这个文件里面的内容，我们后续再展开。

当其他模型需要复用已有模型的时候，就可以通过ID来引用已有模型。
譬如针对文件解析模型，它的解析模型配置为：

    <file-model androidlogsuite:id="+filemodel1" androidlogsuite:filename="bugreport">
        <model-config androidlogsuite:id="@dumpsys-diskstats"/> 
        <model-config androidlogsuite:id="@dumpsys-meminfo"/> 
        <model-config androidlogsuite:id="@dumpsys-batterystats"/> 
    </file-model>
    
文件解析模型，复用了多个adb静态命令解析模型，表示支持多种类型日志的解析。

### 基于正则表达式解析日志

前面我们看到了解析模型的定义，实际完成解析操作配置并没有展开讨论。面对无结构的文本内容，正则匹配是一个比较理想解析方式。
`androidlogsuite`采用的方式就是正则匹配解析。打开meminfo.xml文件，这个文件里面定义了需要解析的实际内容：

    <parse-config androidlogsuite:type="all">
        <parse-rule androidlogsuite:startWith="time"
            androidlogsuite:regx="(?:time,)(\d+)(?:,)(\d+)"
            androidlogsuite:casesensitive="false" androidlogsuite:groups="1,2" />
        <parse-rule androidlogsuite:startWith="proc"
            androidlogsuite:regx="(?:proc,)(\D+)(?:,)(.+)(?:,)(\d+)(?:,)(\d+)(?:.+)"
            androidlogsuite:casesensitive="false" androidlogsuite:groups="1,2,3,4" />
        <parse-rule androidlogsuite:startWith="oom"
            androidlogsuite:regx="(?:oom,)(\D+)(?:,)(\d+)"
            androidlogsuite:casesensitive="false" androidlogsuite:groups="1,2" />
        <parse-rule androidlogsuite:startWith="ram"
            androidlogsuite:regx="(?:ram,)(\d+)(?:,)(\d+)(?:,)(\d+)"
            androidlogsuite:casesensitive="false" androidlogsuite:groups="1,2,3" />
    </parse-config>


## Task和Model的联动 

### 缓冲池

当需要从Socket连接中读写数据时，缓冲池能够提交效率。

Model会维护两个队列，clean和dirty。
当有新数据读取需求时，会从clean队列中取出一块缓冲区，置入dirty队列。
当有新数据解析需求时，会从dirty队列中取出一块缓冲区，完成解析操作后，又把缓冲区置入clean队列。

clean和dirty队列都是从缓冲池中获取缓冲区，达到缓冲区的循环利用。

### ModelParser

都Socket连接有数据可读时，说明发送给adbd服务进程的命令已经返回。这时，会获取一块缓冲区ByteBuffer，
用来缓存读取的数据。

数据读取完毕后，把这块缓冲区放入dirty的队列，表示待处理。同时，也会启动与Task关联的ModelParser来完成对缓冲区的解析操作。

ModelParser是一个工作线程，它从dirty的队列取数据，完成数据解析。解析完成以后，会重新将缓冲区回收。

`androidlogsuite`是对行进行正则匹配的，所以在解析缓冲区数据时，需要通过'\n'字符来区分行。