---
layout: post
category: Android系统原理
title: Android四大组件之Activity--启动模式
tagline:
tags:  [Android四大组件]
---


Activity的启动模式一共有四种：Standard、SingleTop、SingleTask和SingleInstance。
之所以要设计出不同的启动模式，是因为要应对不同的用户交互场景，以便达到更好的体验。

要决定一个Activity的启动模式，只需要指定Activity的launchMode即可，有两种方式：

1. 在**AndroidManifest.xml**的&lt;Activity&gt;标签中设置<code>android:launchMode</code>属性，
   在解析**AndroidManifest.xml**的时候，Activity相关的信息都会被**ActivityInfo**这个类管理起来，
   在ActivityInfo中，launchMode会有以下四个取值，也就对应到了Activity的四种启动方式：

        public static final int LAUNCH_MULTIPLE = 0;	// 默认值，对应到Standard模式
        public static final int LAUNCH_SINGLE_TOP = 1;
        public static final int LAUNCH_SINGLE_TASK = 2;
        public static final int LAUNCH_SINGLE_INSTANCE = 3;

   > ActivityInfo类的具体结构可以参见[Android四大组件之Activity--管理方式](/2016-02-01-Activity-Maintenance)一文。

2. 通过**Intent Flags**设置Activity的启动方式：

		Intent.FLAG_ACTIVITY_SINGLE_TOP  // 以singleTop模式启动
        Intent.FLAG_ACTIVITY_NEW_TASK    // 以singleTask模式启动

   > 需要说明的是，standard和singleInstance并没有对应的**Intent Flags**，可以从[Android四大组件之Activity--启动过程](2016-07-29-Activity-LaunchProcess-Part1.md)一文
   > 中了解Android内部对不同**Intent Flags**的处理。

作为一个Android开发人员，这四种Activity启动模式或许耳熟能详，但其使用场景，未必大家都有所了解。
下面我们就来介绍一下这四种启动模式对Activity的影响以及常见的使用场景。

# 1. standard(MULTIPLE)

**MULTIPLE**意指Activity可以有多个实例，不同任务中可以有不同的Activity实例，同一个任务中也可以有多个Activity实例。
默认情况下，Activity都会按照此种模式启动。

Lollipop(Android 5.0)前后对这种启动模式的处理方式是不同的：

- **在Lollipop之前**，每次以MULTIPLE启动的Activity都会被压入当前任务的顶部，启动 **N** 次，在当前任务就会出现 **N** 个Activity的实例，每次Back键就会销毁一个，直到按了 **N** 次Back键。

- **从Lollipop开始**，如果要以MULTIPLE启动Activity都是来自同一应用，那么还是会像之前一样，压入当前任务的顶部; 如果是来自不同应用，那么将会创建一个新的任务，然后将Activity的实例压入新的任务中。Lollipop做的优化主要是针对多任务的显示。

我们来具体分析一下standard模式，假设有来自两个不同应用程序(APK)的Activity：

<div align="center"><img src="/assets/images/activity/launchmode/1-activity-launchmode-applications.png" alt="activities in different applications"/></div>

Activity A和Activity B属于application 1， Activity X和Activity Y属于application 2。

<div align="center"><img src="/assets/images/activity/launchmode/2-activity-launchmode-standard-pre-lollipop.png" alt="standard pre-lollipop"/></div>

  1. 首先，从Activity A启动了同一个应用中的Activity B，这时，会将Activity B压入任务Task 1的栈顶，Activity B变成了当前可见的实例;
  2. 然后，从Activity B启动了另外一个应用Application 2中的Activity Y，
    这时，还是会将Activity Y压入Task 1的栈顶，Activity Y变成当前可见状态;
  3. 最后，当Back键响应时，会销毁当前可见的Activity Y，将之前的Activity B变成可见状态。

如果在上述第2步的时候，又启动了Activity B，那么又会新建一个Activity B的实例，压入Task 1栈顶。
具体图例不展示了，各位看官可以通过`adb shell dumpsys activity`来查看这种场景下任务的情况：

{% highlight console %}
$ adb shell dumpsys activity activities
...
* TaskRecord{2fe897e2 #3184 A=org.xo.launchmode.application1 U=0 sz=3}
  affinity=org.xo.launchmode.application1
  ...
  Activities=[ActivityRecord{5ebd996 u0 org.xo.launchmode.application1/.ActivityA t3184}, ActivityRecord{267cd2bf u0 org.xo.launchmode.application1/.ActivityB t3184}]
    * Hist #2: ActivityRecord{1d910399 u0 org.xo.launchmode.application1/.ActivityB t3184}
    ...
    * Hist #1: ActivityRecord{1e7fe4c8 u0 org.xo.launchmode.application1/.ActivityB t3184}
    ...
    * Hist #0: ActivityRecord{5ebd996 u0 org.xo.launchmode.application1/.ActivityA t3184}
...
{% endhighlight %}

TaskRecord中有3个Activity的实例， 从顶到底排列，Hist #2和#1都是Activity B的实例，#0是底部的Activity A的实例。

这个过程是Lollipop之前的做法，只要不断地以standard模式启动Activity，就会将新的Activity实例压入当前的任务顶。
Lollipop开始有了一些优化，虽然从用户体验来看Activity的启动，和Lollipop之前并没有区别，
但从多任务窗口来查看当前的任务时，可以看到两个不同的任务，这更加符合用户的思维习惯。
Lollipop以standard模式启动Activity如下图所示：

<div align="center"><img src="/assets/images/activity/launchmode/3-activity-launchmode-standard-lollipop.png" alt="standard pre-lollipop"/></div>

  1. 首先，还是一样的，从Activity A启动同一应用中的Activity B;
  2. 然后，**区别来了**，从Activity B启动了另外一个应用Application 2中的Activity Y，
     这时，会新建一个任务Task 2,并将Activity Y压入 Task 2的栈顶，Task 1将会被挪到后台;
  3. 最后，当Back键响应时，会销毁Task 2中的Activity Y。Task 2变成了空的任务，
     Task 1会被重新挪到前台，Activity Y的上一个Activity B变成了可见状态。

以MULTIPLE模式启动Activity是最常见的用户场景，所以又名standard，在一个应用中，绝大多数Activity都是以这种模式启动的。

# 2. singleTop

singleTop意指仅有一个栈顶的Activity实例，如果当前任务的顶部就是待启动的Activity实例，那么并不会再创建一个新的Activity实例，而是仅仅调用已有实例的**onNewIntent()**方法，所以对于要以singleTop启动的Activity，需要处理**onCreate()**和**onNewIntent()**这两种情况下的启动参数。

以singleTop模式启动Activity的过程如下图所示：

<div align="center"><img src="/assets/images/activity/launchmode/4-activity-launchmode-singletop.png" alt="singleTop"/></div>

  1. 首先，启动了Application 1中的Activity A，位于任务Task 1的顶部，Activity A是当前可见的实例;
  2. 然后，从Activity B又启动了相同了Activity B，**区别于standard模式的地方来了**
     这时，并不会创建一个Activity B的新实例，而是调用已有Activity B的**onNewIntent()**方法;
  3. 最后，当Back键响应时，会销毁Activity B，重新将Activity A置为可见状态。

singleTop和standard的区别在于，如果栈顶已经存在待启动Activity的实例，singleTop会利用已有的实例，而standard仍然会新建一个。
然而，singleTop只对当前应用启动有效，对于跨应用启动的情况，singleTop与standard模式没有区别。

什么是跨应用启动呢？假设当前有一个任务的顶部Activity设置了singleTop模式，如果有一个来自其他应用的Intent要启动这个Activity，就是跨应用启动。在这种情况下，Intent并不会去寻找已有任务的Activity，而是直接创建一个新的Activity实例：在lollipop之前，将Activity实例置于发起者的任务顶，在Lollipop之后，将Activity实例置于新任务的根部。singleTop和standard都是这么做的：

<div align="center"><img src="/assets/images/activity/launchmode/5-activity-launchmode-singletop-cross-application.png" alt="singleTop Cross-Application"/></div>

从Application 1中的Activity B以singleTop或standard模式启动Application 2中的Activity Y，行为都是一样的：新建Activity Y的实例，压入任务Task 2的栈顶。当Back键响应时，会销毁Activity Y的实例，将Task 1重新挪到前台，Activity Y之前的Activity B也会被重新置为可见状态。

singleTop也是很常见的启动模式，当我们只需要更新一个Activity的显示数据时，就会用到这种模式，譬如：
新建短信界面和短信会话界面都是com.android.mms.ui.ComposeMessageActivity，
当在这个界面编辑短信时，收到对方的一条新短信，这时，会要求启动短信会话界面，然而，此时并不需要新建一个ComposeMessageActivity的实例，
只需要刷新一下数据就可以了; 否则，会导致一种很困惑的用户操作行为：按一下Back，仍然停留在新建短信界面。

# 3. singleTask

singleTask意指一个Activity实例仅有一个宿主任务，这里有两种可能的情况：

1. 待启动的Activity实例存在;
2. 待启动的Activity实例不存在。

我们先来讨论第1种情况。如果某个任务中存在Activity实例，则仅仅是调用已有实例的**onNewIntent()**方法，在这之前，如果已有Activity实例不是位于任务顶，那么在它之上的其他Activity都会被销毁，确保目标Activity位于栈顶。

与singleTop相同的是，singleTask也会调用已有实例的**onNewIntent()**方法，不同的是：singleTop可能会存在多个Activity实例，而singleTask只会存在一个Activity实例，即无论来自何方的Intent，要以singleTask模式来启动Activity，最终都只会落到一个相同的任务中，而且这个任务中Activity实例有且仅有一个。

<div align="center"><img src="/assets/images/activity/launchmode/6-activity-launchmode-singletask.png" alt="singleTask"/></div>

- 首先，从Activity A中以singleTask的方式启动Activity X。由于Activity X中已经存在于任务Task 2中，所以并不会新建一个Activity X的实例;
- 然后，Task 2会被挪至前台，由于Activity X并非Task 2的栈顶，所以需要清楚在Activity X之上的所有Activity，这样一来，Ativity Y就会被清除，走完它的生命周期;
- 最后，当Back键响应时，Activitiy X会被销毁，Task 1又会被重新挪到前台。

再来看第2种情况：待启动Activity的实例不存在，这时候肯定会新建一个Activity的实例，但是否会新建一个任务呢？这又得分情况讨论，关键在于
taskAffinity这个属性。新建的Activity实例需要寻找一个宿主任务，当某个任务的affinity属性(**TaskRecord.affinity**)与Activity实例的taskAffinity属性(**ActivityRecord.taskAffinity**)相同时，则认为找到了宿主任务。所以，是否新建一个任务，还取决于taskAffinity属性。

如果没有为&lt;Activity&gt;标签设置<code>android:taskAffinity</code>属性，则会继承自&lt;Application&gt;标签;
如果&lt;Application&gt;标签也没有设置，则taskAffinity就是包名。
在这种情况下，从Application 1中的Activity A以singleTask模式启动Activity B时，并不会新建任务，而是将Activity B压入已有任务的顶部，就像standard模式一样。除非将&lt;ActivityB&gt;设置为一个新的值:

{% highlight xml %}
<activity
    android:name=".ActivityB"
    android:taskAffinity="" />
{% endhighlight %}

这时候，Activity B就会在一个新的任务中启动，并且新任务的affinity属性为空。图例就不给出了，可以通过
`adb shell dumpsys activity`命令查看Activity的情况：

{% highlight console %}
$ adb shell dumpsys activity activities
* TaskRecord{1d7975ca #3187 I=org.xo.launchmode.application1/.ActivityB U=0 sz=1}
  ...
  Activities=[ActivityRecord{1f51ad3 u0 org.xo.launchmode.application1/.ActivityB t3187}]
  * Hist #0: ActivityRecord{1f51ad3 u0 org.xo.launchmode.application1/.ActivityB t3187}
...
* TaskRecord{2fe897e2 #3184 A=org.xo.launchmode.application1 U=0 sz=1}
  affinity=org.xo.launchmode.application1
  ...
  Activities=[ActivityRecord{5ebd996 u0 org.xo.launchmode.application1/.ActivityA t3184}]
  * Hist #0: ActivityRecord{5ebd996 u0 org.xo.launchmode.application1/.ActivityA t3184}
...
{% endhighlight %}

使用singleTask的场景并不多，当希望有一个仅有Activity实例为全局服务，而且这个Activity上又需要覆盖其他Activity时，就适合使用singleTask模式。譬如：设置的主界面com.android.settings.Settings，无论从哪个应用唤起Settings，都只会有一个Settings的实例存在，一些SubSettings界面也可以压到Settings的界面之上，当这个任务从后台重新挪到前台时，仍保持任务中的顺序相应Back键。


# 4. singleInstance

singleInstance意指有且仅有一个Activity实例，这一点与singleTask相同，但不同的是，singleTask的任务中可以有其他Activity实例，而singleInstance的任务中有且仅有一个singleInstance的Activity实例。

singleInstance的使用场景很少，但却非常显眼。譬如：来电界面com.android.incallui.InCallActivity，
这个界面可以被来其他地方的Intent唤起，而且这个界面之上不允许覆盖其他界面，每次启动时，都是一个唯一任务唯一实例的存在。

Activity启动模式是应用程序交互设计的基础，standard和singleTop模式相对用得较多; singleTask的行为显得有点诡异，因为这种模式会在用户不可知的情况下销毁Activity(宿主任务中，目标Activity实例之上的Activity都将被销毁); singleInstance不用则矣，用则就是一个特殊的存在。
这里，简单总结一下四种启动模式的异同：

- standard和singleTop的行为很相近，但遇到相同的栈顶Activity实例，standard会再次新建一个，而singleTop不会;
- singleTop和singleTask在找到目标的Activity实例时，会调用其**onNewIntent()**方法; singleTop可以存在多个相同的Activity实例，而singleTask仅存在一个;
- singleTask和singleInstance都只会存在一个相同的Activity实例，singleTask任务中可以有其他不同的Activity实例，而singleInstance栈中仅有一个Activity实例。

---

**参考资料**

1. <http://developer.android.com/intl/zh-cn/guide/components/tasks-and-back-stack.html>
2. <http://inthecheesefactory.com/blog/understand-android-activity-launchmode/en>
3. <http://blog.csdn.net/luoshengyang/article/details/6714543>
