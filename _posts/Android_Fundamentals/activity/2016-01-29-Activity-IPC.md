---
layout: post
category: Android系统原理
title: Android四大组件之Activity--应用进程与系统进程的通信
tagline:
tags:  [Android四大组件]
---

Android中有一个系统进程(system_process，在Lollipop之前，叫system_server)，运行着系统的重要服务(AMS, PMS, WMS)，
针对Activity而言，系统进程需要不断地调度Activity执行，管理Activity的状态;
每一个APK都需要运行在一个应用进程中，有自己独立的内存空间，
针对Activity而言，应用进程需要执行Activity生命周期函数(onCreate, onStart, ...onDestroy)的具体逻辑。

应用进程需要频繁与系统进程通信，譬如Activity生命周期的各个方法都是需要经过系统进程调度的，只是在应用进程进行回调，这就需要从系统到应用的跨进程调用; 应用进程有需要将当前Activity的状态告诉系统进程，以便系统将Activity驱动到下一个状态，这就需要从应用到系统的跨进程调用。

应用进程与系统进程相互通信的手段，就是老生长谈的Binder机制。
本文要分析的自然不是Binder机制的内在原理，而是应用进程与系统进程建立在Binder之上通信的业务逻辑，Android为此设计了两个Binder接口：

- **[IApplicationThread]()**: 作为系统进程请求应用进程的接口;
- **[IActivityManager]()**: 作为应用进程请求系统进程的接口。

<div align="center"><img src="/assets/images/activity/ipc/1-activity-ipc-overview.png" alt="IPC Overview"/></div>


# 1. 通信接口的实现

先上一张类图，描述了两个Binder接口实现相关的类：

<div align="center"><img src="/assets/images/activity/ipc/2-activity-ipc-classes.png" alt="Class Diagram"/></div>

在接口实现手段上，应用进程与系统进程是一致的，毕竟逃不出Binder的标准实现。

**在系统进程一侧**：

- 最上层的有**IActivityManager**的接口定义，图中只列出了少数成员函数作为示意;
- 往下一层，有两个接口的实现，其中一个**ActivityManagerNative**作为服务端的“桩(Stub)”，其主要职责就是对远程传递过来的数据进行”反序列化(unparcel)”; 另一个**ActivityManagerProxy**作为服务的“代理(Proxy)”,运行在客户端，其主要职责就是将数据进行“序列化(parcel)”，再传递给远程的“桩(Stub)”;
- 再下一层，就是接口的具体业务实现**AMS**了，对“桩(Stub)”做了继承扩展，逻辑庞大到令人害怕。

**在应用进程一侧**：

- 最上层的有**IApplicationThread**的接口定义，
- 往下一层，同样有“代理(Proxy)”和“桩(Stub)”，连类名都如出一辙;
- 再下一层，具体业务的实现类是**ApplicationThread**是ActivityThread的一个内部类，ApplicationThread负责响应系统进程发起的请求，这些请求大部分都是需要调度在应用进程的主线程执行，而ActivityThread是应用进程的主线程，通过Handle往主线程抛消息，ApplicationThread就轻松将具体执行任务的工作转交给了主线程。

> “代理(Proxy)”和“桩(Stub)”是Binder接口实现时成对出现的概念。可以对应到一个生活中的例子：银行的取款机就像是银行的业务代理(Proxy)，客户只需要通过取款机，就能方便地完成存、取款等业务。对于客户来说，银行实际是什么样子，钱存在哪，都不重要了，只要有取款机在就够了。对于取款机这个代理而言，它需要连接银行的服务器(Stub)，完成数据传递。

上面的类图中，用两种不同的颜色对类进行了区分。除了Binder的标准实现，还示意了几个不同的类依赖关系：

- ProcessRecord类和ActivityRecord类的对象是运行在系统进程之中，它们都由AMS管理;
- ProcessRecord依赖于客户端进程中的ApplicationThread对象，而客户端进程中的Activity依赖于ActivityRecord。

这种依赖关系的构建，是在启动一个全新的Activity时，利用**IActivityManager**和**IApplicationThread**完成了数据绑定操作。
绑定成功以后，相当于应用进程和系统进程相互打了个招呼，知道了彼此的存在，后续就可以进行更加深入友好的交流。

下面，我们就来分析一下启动一个Activity时数据绑定的过程。

# 2. 启动一个Activity的通信过程

当启动一个全新的Activity时，Activity的宿主进程可能还未启动，这时候就需要先启动宿主进程，在[Android四大组件之Activity--管理方式]()一文中，我们介绍过：

1. AMS通过ProcessRecord来维护进程运行时的状态信息，需要将应用进程绑定到ProcessRecord才能开始一个Application的构建;
2. AMS通过ActivityRecord来维护Activity运行时的状态信息，需要将Activity绑定到AMS中的ActivityRecord能开始Activity的生命周期。

这两个绑定操作是应用进程与系统进程相互通信的开始。

## 2.1. Application与ProcessRecord的绑定

**从应用进程到系统进程**

在ActivityThread创建的时候，会将自己的ApplicationThread绑定到AMS中，调用关系如下所示：

    ActivityThread.main()
    └── ActivityThread.attach()
        └── IActivityManager.attachApplication(mAppThread)
            └── Binder.transact()

应用进程作为客户端，通过**IAcitivtyManager**接口发起了跨进程调用，
跨进程传递的参数**mAppThread**就是IApplicationThread的实例，
执行流程从应用进程进入到系统进程：

    ActivityManagerService.onTransact()
    └── ActivityManagerService.attachApplication(IApplicationThread thread)

AMS作为IActivityManager接口的服务端实现，会响应客户端的请求，最终**AMS.attachApplication()**函数会被执行，
该函数接收跨进程传递过来的**IApplicationThread**实例，将其绑定到系统进程。
具体的绑定操作细节此处不表，我们只需要知道AMS中维护了所有进程运行时的信息(ProcessRecord)，一旦发生了应用进程的绑定请求，
ProcessRecord.thread就被赋值成应用进程的**IApplicationThread**实例，这样一来，在AMS中就能通过该实例发起向应用进程的调用。

**从系统进程到应用进程**

在**AMS.attachApplication()**的过程中，会有一些信息要传递给应用进程，以便应用进程的初始化，系统进程会发起如下函数调用：

    ActivityManagerService.attachApplication()
    └── ActivityManagerService.attachApplicationLocked()
        └── IApplicationThread.bindApplication(processName, appInfo ...)
            └── Binder.transact()

此时，AMS会反转角色，即系统进程作为客户端，通过**IApplicationThread**接口向应用进程发起调用。
AMS中维护了ProcessRecord这个数据结构，包含了进程运行时的信息，譬如应用进程的名称processName、解析AndroidManifest.xml得到的数据结构ApplicationInfo等，其中，要传递给应用进程的数据都是Parcelable类型的实例。应用进程响应请求的调用关系如下所示：

    ApplicationThread.onTransact()
    └── ApplicationThread.bindApplication()
        └── ActivityThread.H.handleMessage(BIND_APPLICATION)
            └── ActivityThread.handleBindApplication()
                └── Application.onCreate()

**ApplicationThread**作为**IApplicationThread**接口的服务端实现，运行在应用进程中，
然后**ApplicationThread.bindApplication()**会被执行，完成一些简单的数据封装(AppBindData)后，通过Handler抛出**BIND_APPLICATION**消息。这一抛，就抛到了主线程上，**ActivityThread.handleBindApplication()**会被执行，接着就到了各位观众较为熟悉的**Application.onCreate()**函数。历经应用进程和系统进程之间的一个来回，总算是创建了一个应用程序。


## 2.2. Acitivity与ActivityRecord的绑定

**ActivityRecord的Token**

在Activity类中有一个IBinder类型的属性：

	private IBinder mToken;

IBinder类型表示这个属性是一个远程对象的引用，取了一个恰如其分的变量名：mToken。
为什么叫Token呢？这个名字源自于**IApplicationToken.aidl**这个接口，
最终ActivityRecord中的一个内部类Token实现了这个接口：

{% highlight java %}
static class Token extends IApplicationToken.Stub {
    final WeakReference<ActivityRecord> weakActivity;

    Token(ActivityRecord activity) {
        weakActivity = new WeakReference<ActivityRecord>(activity);
    }
    ...
}
{% endhighlight %}

Token持有了一个ActivityRecord实例的弱引用。在创建一个ActivityRecord的时候，就会创建了一个Token类型的对象：

{% highlight java %}
ActivityRecord(ActivityManagerService _service, ProcessRecord _caller,
    int _launchedFromUid, String _launchedFromPackage, Intent _intent, String _resolvedType,
    ActivityInfo aInfo, Configuration _configuration,
    ActivityRecord _resultTo, String _resultWho, int _reqCode,
    boolean _componentSpecified, ActivityStackSupervisor supervisor,
    ActivityContainer container, Bundle options) {
    service = _service
    appToken = new Token(this);
    ...
}
{% endhighlight %}

构造一个ActivityRecord时，会将自己(this)传给Token，变量**ActivityRecord.appToken**存的就是最终创建出来的Token。

**将Token传递给Activity**

在启动一个新的Activity时，AMS会将ActivityRecord的Token传递给应用进程，调用关系如下所示：

    ActivityStackSupervisor.realStartActivityLocked(ActivityRecord, ...)
    └── IApplicationThread.scheduleLaunchActivity(...token, ...)
        // 将ActivityRecord的Token跨进程传递给应用进程
        └── Binder.transact()

**ActivityStackSupervisor.realStartActivityLocked()**表示要启动一个Activity实例，ActivityRecord作为参数。从ActivityRecord中提取出Token对象，作为跨进程调用的参数，通过**IApplicationThread.scheduleLaunchActivity()**传递到应用进程。

应用进程这一侧，会收到启动Activity的跨进程调用，触发以下一系列的函数调用：

    ApplicationThread.onTransact()
    └── ApplicationThread.scheduleLaunchActivity(...token, ...)
        // token将被封装进ActivityClientRecord这个数据结构中
        └── ActivityThread.H.handleMessage()
            └── ActivityThread.handleLaunchActivity(LAUNCH_ACTIVITY)
                └── ActivityThread.performLaunchActivity(ActivityClientRecord, ...)
                    // 从ActivityRecord取出token
                    └── Activity.attch(...token, ...)

标准的Binder服务端处理流程，收到AMS传递过来的Token对象，进行一下数据封装(ActivityClientRecord)，然后通过Handler抛出一个**LAUNCH_ACTIVITY**消息。这个消息显然也是抛到了应用进程的主线程去执行，所以**ActivityThread.performLaunchActivity()**函数会在主线程上执行，该函数从封装的数据结构ActivityClientRecord中取出Token对象，调用**Activity.attach()**函数，将其绑定到Activity上，如此一来，就建立应用进程的Activity与系统进程中ActivityRecord的关联。

系统进程维护的是ActivityRecord，应用进程维护的是Activity，两者之间的映射关系就是利用Token来维系的。
应用进程的Activity在创建的时候，就被赋予了一个Token，拿着这个Token就能完成后续与系统进程的通信。
在发生Activity切换时，应用进程会将上一个Activity的Token(**AMS.startActivity()**的输入参数**resultTo**)传递给系统进程，系统进程会根据这个Token找到ActivityRecord，对其完成调度后，再通知应用进程：Activity状态发生了变化。

> Token就像一个令牌，揣着这个令牌，就是游走江湖的身份象征。
> Activity出生的时候，管理者(AMS)就会登记Activity的真实身份(ActivityRecord)，并颁发一个令牌(Token)给Activity。
> 以后这个Activity要有什么行为，都要交出令牌，让管理者核实一下真实身份。
