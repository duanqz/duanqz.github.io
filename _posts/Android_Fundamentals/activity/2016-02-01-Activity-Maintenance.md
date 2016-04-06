---
layout: post
category: Android系统原理
title: Android四大组件之Activity--管理方式
tagline:
tags:  [Android四大组件]
---
{% include JB/setup %}

# 1. 概览

Activity的管理有**静态**和**动态**两层涵义：

- **静态**是指Activity的代码组织结构，即Application中声明的Activity的集合，这些Activity被组织在一个APK中，有特定的包名。
  在编写应用程序时，Activity对应到用户界面，它定义了用户界面的布局、交互行为、启动方式等，最重要的，是Activity的生命周期函数。
  在应用进程看来，只需要按照Android定义的规范，实现生命周期函数的具体逻辑即可，所有的用户界面都遵循同一个规范。
  编写完一个应用程序的所有用户界面，就算是完成了Activity的静态管理。

- **动态**是指Activity的运行调度方式，即Activity生命周期的执行过程中，内部数据结构的变化，Android对所有Activity进行统一管理。
  在一个应用程序安装时，系统会解析出APK中所有Activity的信息，当显示APK中的用户界面时，就需要调度Activity的生命周期函数了。
  系统进程(system_process)中维护了所有Activity的状态，管理中枢就是ActivityManagerService，Android为此做了精密的设计，采用
  **栈** 作为基本的数据结构。

本文分析的Activity管理方式属于**动态**这个层面，也就是系统进程中针对Activity的调度机制。

# 2. Activity管理的基础

Activity的管理离不开基础的数据结构以及它们之间的相互关联，
所以，笔者会从基础的数据结构出发，分析类的属性和行为，并结合一些场景进行源码分析; 进一步，会分析各个类之间关联关系的构建过程。
这样一来，整个Activity管理运转的模型就清楚了，这个模型承载的很多业务，本文不会具体展开，
在[Android四大组件之Activity--启动过程]()一文中，笔者会再详细介绍一种典型的业务。

## 2.1 数据结构

Activity管理相关的数据结构包括：

- [ActivityRecord](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/ActivityRecord.java)
- [TaskRecord](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/TaskRecord.java)
- [ActivityStack](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/ActivityStack.java)
- [ActivityDisplay](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/ActivityStackSupervisor.java)
- [ActivityStackSupervisor](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/ActivityStackSupervisor.java)
- [ProcessRecord](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/ProcessRecord.java)

这些数据结构都是Java类，它们都属于系统进程的范畴，即对象的构建和销毁都在系统进程中完成，笔者将从类的属性和行为这两个角度来分析类的职能。
Android有一些约定俗成的函数命名方式，与Activity管理相关很多函数都会带有**Locked**后缀，表示这些函数需要进行多线程同步操作(synchronized)，它们会读/写一些多线程共享的数据，读者在分析代码的时候可以适当关注。

先上一张数据结构的概览图：

<div align="center"><img src="/assets/images/activity/maintenace/1-activity-maintenace-structure.png" alt="Maintenace Guideline"/></div>

图中的方框可以理解为一个中包含关系：譬如一个TaskRecord中包含多个ActivityRecord; 图中的连接线可以理解为等价关系，譬如同一个ActivityRecord会被TaskRecord和ProcessRecord引用，两者是从不同维度来管理ActivityRecord。

- **ActivityRecord**是Activity管理的最小单位，它对应着一个用户界面;
- **TaskRecord**也是一个栈式管理结构，每一个**TaskRecord**都可能存在一个或多个**ActivityRecord**，栈顶的**ActivityRecord**表示当前可见的界面;
- **ActivityStack**是一个栈式管理结构，每一个**ActivityStack**都可能存在一个或多个**TaskRecord**，栈顶的**TaskRecord**表示当前可见的任务;
- **ActivityStackSupervisor**管理着多个**ActivityStack**，但当前只会有一个获取焦点(Focused)的**ActivityStack**;
- **ProcessRecord**记录着属于一个进程的所有**ActivityRecord**，运行在不同**TaskRecord**中的**ActivityRecord**可能是属于同一个
  **ProcessRecord**。

### ActivityRecord

ActivityRecord是AMS调度Activity的基本单位，它需要记录AndroidManifest.xml中所定义Activity的静态特征，同时，
也需要记录Activity在被调度时的状态变化，因此ActivityRecord这个类的属性比较多。

属性 | 描述
----- | -----
**ActivityInfo** | 从&lt;activity&gt;标签中解析出来的信息，包含launchMode，permission，taskAffinity等
**mActivityType** | Activity的类型有三种：APPLICATION_ACTIVITY_TYPE(应用)、HOME_ACTIVITY_TYPE(桌面)、RECENTS_ACTIVITY_TYPE(最近使用)
**appToken** | 当前ActivityRecord的标识
**packageName** | 当前所属的包名，这是由&lt;activity&gt;静态定义的
**processName** | 当前所属的进程名，大部分情况都是由&lt;activity&gt;静态定义的，但也有例外
**taskAffinity** | 相同taskAffinity的Activity会被分配到同一个任务栈中
**intent** | 启动当前Activity的Intent
**launchedFromUid** | 启动当前Activity的UID，即发起者的UID
**launchedFromPackage** | 启动当前Activity的包名，即发起者的包名
**resultTo** | 在当前ActivityRecord看来，resultTo表示上一个启动它的ActivityRecord，当需要启动另一个ActivityRecord，会把自己作为resultTo，传递给下一个ActivityRecord
**state** | ActivityRecord所处的状态，初始值是ActivityState.INITIALIZING
**app** | ActivityRecord的宿主进程
**task** | ActivityRecord的宿主任务栈
**inHistory** | 标识当前的ActivityRecord是否已经置入任务栈中
**frontOfTask** | 标识当前的ActivityRecord是否处于任务栈的根部，即是否为进入任务栈的第一个ActivityRecord
**newIntents** | Intent数组，用于暂存还没有调度到应用进程Activity的Intent

由于ActivityRecord是一个最基本的数据结构，所以其行为相对较少，大都是一些用于判定和更新当前ActivityRecord状态的函数：

行为 | 描述
----- | -----
**putInHistory(), takeFromHistory(), isInHistory()** | 基于inHistory属性，来判定和更新ActivityRecord是否在任务栈的状态值
**isHomeActivity(), isRecentsActivity(), isApplicationActivity()** | 基于mActivityType属性，判定Activity的类型
**setTask()** | 设置ActivityRecord的宿主任务栈
**deliverNewIntentLocked()** | 向当前ActivityRecord继续派发Intent。在一些场景下，位于任务栈顶的ActivityRecord会继续接受新的Intent(譬如以singleTop方式启动的同一个Activity)，这时候，会触发调度**Activity.onNewIntent()**函数
**addNewIntentLocked()** | 如果Intent没有派发到应用进程，则通过该函数往**newIntents**数组中添加一个元素。

要理解ActivityRecord这个数据结构，可以从其构造函数出发，理解其属性在什么场景下会发生变化。
每次需要启动一个新的Activity时，都会构建一个ActivityRecord对象，这在**ActivityStackSupervisor.startActivityLocked()**函数中完成，构造一个ActivityRecord要传入的参数是相当多的：

{% highlight java %}
ActivityRecord(ActivityManagerService _service, ProcessRecord _caller,
      int _launchedFromUid, String _launchedFromPackage, Intent _intent, String _resolvedType,
      ActivityInfo aInfo, Configuration _configuration,
      ActivityRecord _resultTo, String _resultWho, int _reqCode,
      boolean _componentSpecified, ActivityStackSupervisor supervisor,
      ActivityContainer container, Bundle options) {
    service = _service; // AMS对象
    appToken = new Token(this); //appToken可以进行跨进程传递，标识一个AR对象
    info = aInfo; //从AndroidManifest.xml中解析得到的Activity信息
    launchedFromUid = _launchedFromUid; //譬如从浏览器启动当前AR，那么该属性记录的就是浏览器的UID
    launchedFromPackage = _launchedFromPackage;
    userId = UserHandle.getUserId(aInfo.applicationInfo.uid);
    intent = _intent; //启动当前AR的Intent
    shortComponentName = _intent.getComponent().flattenToShortString();
    resolvedType = _resolvedType;
    componentSpecified = _componentSpecified;
    configuration = _configuration;
    resultTo = _resultTo; //记录上一个AR对象
    resultWho = _resultWho; //reslutTo的字符串标识
    requestCode = _reqCode; //上一个AR对象设定的Request Code
    state = ActivityState.INITIALIZING; //AR的状态，Activity调度时发生改变
    frontOfTask = false; //是否处于Task的根部，调整任务栈中AR顺序时，可能发生改变
    launchFailed = false;
    stopped = false; //pause操作完成状态位
    delayedResume = false;
    finishing = false; //stoped到finished之间的过渡状态位
    configDestroy = false;
    keysPaused = false; //如果置为true，则当前AR不再接受用户输入
    inHistory = false; //将AR压入任务栈后，该状态位被置为true
    visible = true;
    waitingVisible = false;
    nowVisible = false;
    idle = false;
    hasBeenLaunched = false;
    mStackSupervisor = supervisor;
    mInitialActivityContainer = container;
    if (options != null) {
        pendingOptions = new ActivityOptions(options);
        mLaunchTaskBehind = pendingOptions.getLaunchTaskBehind();
    }
    haveState = true;
    if (aInfo != null) {
        //根据aInfo给realActivity, taskAffinity, processName等属性赋值
        ...
    } else {
        //没有aInfo的情况下，赋予默认值
        realActivity = null;
        taskAffinity = null;
        stateNotNeeded = false;
        appInfo = null;
        processName = null;
        packageName = null;
        fullscreen = true;
        noDisplay = false;
        mActivityType = APPLICATION_ACTIVITY_TYPE;
        immersive = false;
    }
}
{% endhighlight %}

### TaskRecord

TaskRecord的职责是管理多个ActivityRecord，本文所述的任务、任务栈指的就是TaskRecord。
启动Activity时，需要找到Activity的宿主任务栈，如果不存在，则需要新建一个，也就是说所有的ActivityRecord都必须有宿主。
TaskRecord与ActivityRecord是一对多的关系，TaskRecord的属性中包含了ActivityRecord的数组;
同时，TaskRecord还需要维护任务栈本身的状态。

属性 | 描述
----- | -----
**taskid** | TaskRecord的唯一标识
**taskType** | 任务栈的类型，等同于ActivityRecord的类型，是由任务栈的第一个ActivityRecord决定的
**intent** | 在当前任务栈中启动的第一个Activity的Intent将会被记录下来，后续如果有相同的Intent时，会与已有任务栈的Intent进行匹配，如果匹配上了，就不需要再新建一个TaskRecord了
**realActivity, origActivity** | 启动任务栈的Activity，这两个属性是用包名(CompentName)表示的，real和orig是为了区分Activity有无别名(alias)的情况，如果AndroidManifest.xml中定义的Activity是一个alias，则此处real表示Activity的别名，orig表示真实的Activity
**affinity** | TaskRecord把Activity的affinity记录下来，后续启动Activity时，会从已有的任务栈中匹配affinity，如果匹配上了，则不需要新建TaskRecord
**rootAffinity** | 记录任务栈中最底部Activity的affinity，一经设定后就不再改变
**mActivities** | 这是TaskRecord最重要的一个属性，TaskRecord是一个栈结构，栈的元素是ActivityRecord，其内部实现是一个数组mActivities
**stack** | 当前TaskRecord所在的ActivityStack

TaskRecord的行为侧重在TaskRecord本身的管理：增/删/改/查任务栈中的元素。

行为 | 描述
----- | -----
**getRootActivity(), getTopActivity()** | 任务栈有**根部(Root)**和**顶部(Top)**，可以通过这两个函数分别获取到根部和顶部的ActivityRecord。获取的过程就是对TaskRecord.mActivities进行遍历，如果ActivityRecord的状态不是finishing，就认为是有效的ActivityRecord
**topRunningActivityLocked()** | 虽然也是从顶至底对任务栈进行遍历获取顶部的ActivityRecord，但这个函数同**getTopActivity()**有区别：输入参数**notTop**，表示在遍历的过程中需要排除**notTop**这个ActivityRecord;
**addActivityToTop(), addActivityAtBottom()** | 将ActivityRecord添加到任务栈的顶部或底部
**moveActivityToFrontLocked()** | 该函数将一个ActivityRecord移至TaskRecord的顶部，实现方法就是先删除已有的，再在栈顶添加一个新的
**setFrontOfTask()** | ActivityRecord有一个属性是frontOfTask，表示ActivityRecord是否为TaskRecord的根Activity。该函数设置TaskRecord中所有ActivityRecord的frontOfTask属性，从栈底往上开始遍历，第一个不处于finishing状态的ActivityRecord的frontOfTask属性置成true，其他都为false
**performClearTaskLocked()** | 清除TaskRecord中的ActivityRecord。当启动Activity时，用了**Intent.FLAG_ACTIVITY_CLEAR_TOP**参数，那么在宿主任务栈中，待启动ActivityRecord之上的其他ActivityRecord都会被清除

仅仅把类的属性和行为罗列出来，当然不足以理解TaskRecord的工作原理。
接下来，将深入部分函数的代码，分析TaskRecord在一些场景下的具体执行逻辑。

**`场景 1`** 启动一个Activity时，通常需要将ActivityRecord压入任务栈顶，**addActivityToTop()**就是为此功能设计：

{% highlight java %}
void addActivityToTop(ActivityRecord r) {
    addActivityAtIndex(mActivities.size(), r);
}
{% endhighlight %}

将ActivityRecord压入栈顶，其实就是在mActivities数组末尾添加一个元素，所以，实际压入栈顶的操作是由**addActivityAtIndex()**完成：

{% highlight java %}
void addActivityAtIndex(int index, ActivityRecord r) {
    // 1. 移除已有的ActivityRecord对象
    if (!mActivities.remove(r) && r.fullscreen) {
        numFullscreen++;
    }
    // 2. 根据任务栈是否为空，设置状态
    if (mActivities.isEmpty()) {
        taskType = r.mActivityType;
        isPersistable = r.isPersistable();
        mCallingUid = r.launchedFromUid;
        mCallingPackage = r.launchedFromPackage;
        maxRecents = Math.min(Math.max(r.info.maxRecents, 1),
                ActivityManager.getMaxAppRecentsLimitStatic());
    } else {
        r.mActivityType = taskType;
    }
    // 3. 在指定的位置添加ActivityRecord
    mActivities.add(index, r);
    // 4. 更新任务栈关联的Intent
    updateEffectiveIntent();
    ...
}
{% endhighlight %}

该函数会经过以下处理过程：

1. 移除任务栈中已有的ActivityRecord对象，即任务栈中不会出现两个同样的ActivityRecord对象。此处需要注意，两次启动同一个Activity，是会产生两个不同的ActivityRecord对象的;

2. 如果任务栈为空，则设置任务栈的初始状态，否则，设置ActivityRecord的类型为任务栈的类型。由此可见，同一个任务栈中，所有ActivityRecord的类型都是一样的，而且是由任务栈的第一个ActivityRecord的类型决定的;

3. 此处的位置就是任务栈顶，也就是mActivities属性的末尾;

4. 任务栈中元素发生了变化，所以需要更新任务栈关联的Intent，这是通过调用**updateEffectiveIntent()**实现的，函数的具体逻辑，在**`场景 3`**中再行分析。

**`场景 2`** 当待显示的Activity压入任务栈后，就需要设置栈顶ActivityRecord的状态，这时候，会调用**topRunningActivityLocked()**函数来获取栈顶的元素，为了更好的分析**topRunningActivityLocked()**的使用场景，笔者把另一个与其功能相似的函数**getTopActivity()**也列出来：

{% highlight java %}
ActivityRecord getTopActivity() {
    for (int i = mActivities.size() - 1; i >= 0; --i) {
        final ActivityRecord r = mActivities.get(i);
        if (r.finishing) {
            continue;
        }
        return r;
    }
    return null;
}

ActivityRecord topRunningActivityLocked(ActivityRecord notTop) {
    for (int activityNdx = mActivities.size() - 1; activityNdx >= 0; --activityNdx) {
        ActivityRecord r = mActivities.get(activityNdx);
        // 除了要求ActivityRecord不是finishing状态以外，还要求不是当前给定输入的ActivityRecord
        if (!r.finishing && r != notTop && stack.okToShowLocked(r)) {
            return r;
        }
    }
}
{% endhighlight %}

两者是从顶到底对任务栈进行遍历，但实现逻辑不同，**topRunningActivityLocked()**接受一个输入参数**notTop**，在寻找时，要求排除**notTop**指定的ActivityRecord，通常，传入的**notTop**都是null，隐含的意思就是栈顶的ActivityRecord还没有被销毁。从函数命名topRunning，也可以看出其与getTop的区别：getTop不管栈顶的死活，拿到就好; topRunning要求拿到的一定是活的栈顶。

另外，**topRunningActivityLocked()**还有一个限制条件： ActivityRecord是可以被显示的(okToShow)，这是通过**ActivityStack.okToShowLocked()**来判定的，主要是为了应多多用户或锁屏显示的Activity，一般情况下，函数返回值都为true。

**`场景 3`** 假定在启动一个Activity时，设置了Intent的FLAG_ACTIVITY_REORDER_TO_FRONT，表示要将Activity重排序到任务栈顶。
如果目标的Activity在任务栈中已经启动过，则需要将其挪至栈顶。譬如目标任务栈从底到顶是 **`A - B - C`**，
然后，又以FLAG_ACTIVITY_REORDER_TO_FRONT启动了 **A**，那最终任务栈会变化为 **`B - C - A`** 。
这就会调用到**moveActivityToFrontLocked()**函数：

{% highlight java %}
final void moveActivityToFrontLocked(ActivityRecord newTop) {
    mActivities.remove(newTop);
    mActivities.add(newTop);
    updateEffectiveIntent();
    setFrontOfTask();
}
{% endhighlight %}

该函数需要调整任务栈中ActivityRecord的顺序，延用上述例子， **A** 将作为参数newTop。
首先，会将 **A** 从任务栈中移除; 然后，再将 **A** 添加到任务栈顶;
接着，会调用**updateEffectiveIntent()**函数来更新任务栈关联的Intent：

{% highlight java %}
void updateEffectiveIntent() {
    final int effectiveRootIndex = findEffectiveRootIndex();
    final ActivityRecord r = mActivities.get(effectiveRootIndex);
    setIntent(r);
}
{% endhighlight %}

该函数会找到一个有效的Root Index，即任务栈底部的索引，根据这个索引值取出对应的ActivityRecord。
延续上述例子，**B** 会被调整为任务栈的根部ActivityRecord，通过调用**setIntent()**来设置当前任务栈关联的Intent为启动 **B** 的Intent，然而，这里可不止改变TaskRecord.intent这一个属性这个简单，与Taskrecord的发起者相关的属性值都要更改，
譬如mCallingUid，mCallingPackage都得更改为 **B** 的发起者：

{% highlight java %}
void setIntent(ActivityRecord r) {
    setIntent(r.intent, r.info);
    mCallingUid = r.launchedFromUid;
    mCallingPackage = r.launchedFromPackage;
}
{% endhighlight %}

这里还有一个重载的setIntent()函数，不再展开分析了，只需要知道诸如affinity， realActivity等属性都会被重置即可。

更新完TaskRecord的Intent，再回到**moveActivityToFrontLocked()**函数中，需要继续更新任务栈的Front。
之前任务栈的Front是 **A**，在发生变化后， Front需要更新为 **B**，然而，TaskRecord并没有一个属性用来记录当前的Front，
它是根据任务栈中每一个ActivityRecord的frontOfTask属性来判定的：

{% highlight java %}
final void setFrontOfTask() {
    boolean foundFront = false;
    final int numActivities = mActivities.size();
    for (int activityNdx = 0; activityNdx < numActivities; ++activityNdx) {
        // 从栈底往上遍历
        final ActivityRecord r = mActivities.get(activityNdx);
        if (foundFront || r.finishing) {
            // 其他ActivityRecord的这个属性都置为false
            r.frontOfTask = false;
        } else {
            // 不为finishing状态，表示已经找到了front的ActivityRecord
            r.frontOfTask = true;
            foundFront = true;
        }

    if (!foundFront && numActivities > 0) {
        mActivities.get(0).frontOfTask = true;
    }
}
{% endhighlight %}

该函数从底到顶对任务栈进行遍历，找到的第一个未结束(finishing = faulse)的ActivityRecord，
将其frontOfTask属性设置成true;其他所有ActivtyRecord的frontOfTask属性设置为false。


### ActivityStack

ActivityStack的职责是管理多个任务栈(TaskRecord)，它是一个栈式结构，栈中的元素是TaskRecord。
每个Activity在特定的时刻都会有一个状态，譬如显示、销毁等，
在应用进程看来，这些状态的变化就是在执行Activity的生命周期函数;
在系统进程看来，这些状态的变化都需要经过ActivityStack来驱动。
Activity的状态是通过ActivityState这个枚举类来定义的：

{% highlight java %}
enum ActivityState {
    INITIALIZING,
    RESUMED,
    PAUSING,
    PAUSED,
    STOPPING,
    STOPPED,
    FINISHING,
    DESTROYING,
    DESTROYED
}
{% endhighlight %}

从INITIALIZING到DESTROYED，所定义状态值示意了Activity生命周期的走向。

属性 | 描述
----- | -----
**stackId** | 每一个ActivityStack都有一个编号，从0开始递增。编号为0，表示桌面(Launcher)所在的ActivityStack，叫做Home Stack
**mTaskHistory** | TaskRecord数组，ActivityStack栈就是通过这个数组实现的
**mPausingActivity** | 在发生Activity切换时，正处于Pausing状态的Activity
**mResumedActivity** | 当前处于Resumed状态的ActivityRecord
**mStacks** | ActivityStack会绑定到一个显示设备上，譬如手机屏幕、投影仪等，在AMS中，通过ActivityDisplay这个类来抽象表示一个显示设备，ActivityDisplay.mStacks表示当前已经绑定到显示设备的所有ActivityStack。当执行一次绑定操作时，就会将ActivityStack.mStacks这个属性赋值成ActivityDisplay.mStacks，否则，ActivityStack.mStacks就为null。简而言之，当mStacks不为null时，表示当前ActivityStack已经绑定到了一个显示设备

Activity状态的变迁，不仅仅是给ActivityRecord.state赋一个状态值那么简单，ActivityStack要对栈进行调整：之前的Activity要销毁或者挪到后台，待显示的Activity要挪到栈顶，这一调整，涉及到的工作就多了。

行为 | 描述
----- | -----
**findTaskLocked()** | 该函数的功能是找到目标ActivityRecord(target)所在的任务栈(TaskRecord)，如果找到，则返回栈顶的ActivityRecord，否则，返回null
**findActivityLocked()** | 根据Intent和ActivityInfo这两个参数可以获取一个Activity的包名，该函数会从栈顶至栈底遍历ActivityStack中的所有Activity，如果包名匹配成功，就返回
**moveToFront)** | 该函数用于将当前的ActivityStack挪到前台，执行时，调用ActivityStack中的其他一些判定函数
**isAttached()** | 用于判定当前ActivityStack是否已经绑定到显示设备
**isOnHomeDisplay()** | 用于判定当前是否为默认的显示设备(Display.DEFAULT_DISPLAY)，通常，默认的显示设备就是手机屏幕
**isHomeStack()** | 用于判定当前ActivityStack是否为Home Stack，即判定当前显示的是否为桌面(Launcher)
**moveTaskToFrontLocked()** | 该函数用于将指定的任务栈挪到当前ActivityStack的最前面。在Activity状态变化时，需要对已有的ActivityStack中的任务栈进行调整，待显示Activity的宿主任务栈需要挪到前台
**insertTaskAtTop()** | 将任务插入ActivityStack栈顶

ActivityStack还有很多与**迁移Activity状态**相关的行为： **startActivityLocked()**， **resumeTopActivityLocked()**，
**completeResumeLocked()**， **startPausingLocked()**， **completePauseLocked()**， **stopActivityLocked()**，
**activityPausedLocked()**， **finishActivityLocked()**， **activityDestroyedLocked()**， 它们与Activity的生命周期调度息息相关，在[Android四大组件之Activity--启动过程]()一文中，会再详细分析这几个函数的实现逻辑，本文还是通过一个简单的场景来分析ActivityStack的行为。

**`场景 1`** 以singleTask的方式启动一个处于后台的Activity，那么，就需要将Activity挪到前台。怎么挪呢？

**第一步，findTaskLocked()**: 找到Activity所在TaskRecord;

{% highlight java %}
ActivityRecord findTaskLocked(ActivityRecord target) {
    ...
    for (int taskNdx = mTaskHistory.size() - 1; taskNdx >= 0; --taskNdx) {
        final TaskRecord task = mTaskHistory.get(taskNdx);
        ...
        final ActivityRecord r = task.getTopActivity();
        ...
        final Intent taskIntent = task.intent;
        final Intent affinityIntent = task.affinityIntent;
        ...
        if (!isDocument && !taskIsDocument && task.rootAffinity != null) {
            if (task.rootAffinity.equals(target.taskAffinity)) {
                return r;
            }
        } else if (taskIntent != null && taskIntent.getComponent() != null &&
            taskIntent.getComponent().compareTo(cls) == 0 &&
            Objects.equals(documentData, taskDocumentData)) {
            return r;
        } else if if (affinityIntent != null && affinityIntent.getComponent() != null &&
            affinityIntent.getComponent().compareTo(cls) == 0 &&
            Objects.equals(documentData, taskDocumentData)) {
            return r
        }
        ...
    }
    return null;
}
{% endhighlight %}

该函数的功能是找到target ActivityRecord所在的Task，如果找到，则返回Task栈顶的ActivityRecord，否则，返回null。
主体逻辑是对ActivityStack中的所有Task进行遍历，以下几种情况表示找到了ActivityRecord的宿主task：

- Affinity相同。rootAffinity表示第一次启动该task时affinity值，如果一个ActivityRecord的taskAffinity属性与其相等，
  那么这个task自然是ActivityRecord的宿主;
- Intent的包名相同。
- Affinity Intent的包名相同。

**第二步，moveToFront()**: 将TaskRecord所在的ActivityStack挪到前台;

{% highlight java %}
final void moveToFront(String reason) {
    if (isAttached()) {
        if (isOnHomeDisplay()) {
            mStackSupervisor.moveHomeStack(isHomeStack(), reason);
        }
        mStacks.remove(this);
        mStacks.add(this);
        final TaskRecord task = topTask();
        if (task != null) {
            mWindowManager.moveTaskToTop(task.taskId);
        }
    }
}
{% endhighlight %}

首先，会有一些判定：

- isAttached()： 只有在当前ActivityStack绑定到显示设备的情况下，才需要挪到;
- isOnHomeDisplay()： 如果当前是默认的显示设备，则对HomeStack(桌面)进行挪动，
  这涉及到对多个ActivityStack的操作，所以需要通过ActivityStackSupervisor完成;
- isHomeStack()： 如果当前是HomeStack，则将其挪到前后; 否则，将HomeStack挪到后台

然后，就是对mStacks这个属性进行操作：在mStacks数组中，删除已有的ActivityStack对象，并添加一个新的，这样做其实达到了一个目的，前台的ActivityStacks处于mStacks末尾。

最后，调用WMS.moveTaskToTop()通知窗口的进行变化调整。

**第三步， moveTaskToFrontLocked()**: 将TaskRecord挪到ActivityStack的栈顶;

{% highlight java %}
final void moveTaskToFrontLocked(TaskRecord tr, ActivityRecord source, Bundle options,
            String reason) {
    final int numTasks = mTaskHistory.size();
    final int index = mTaskHistory.indexOf(tr);
    // 判定ActivityStack是否需要挪动任务栈
    if (numTasks == 0 || index < 0)  {
        ...
        return;
    }
    // 调整ActivityStack
    insertTaskAtTop(tr);
    moveToFront(reason);
    ...
    // 将栈顶的Activity置为Resumed状态
    mStackSupervisor.resumeTopActivitiesLocked();
}
{% endhighlight %}

首先，会经过判定：如果当前的ActivityStack为空，或者不存在要挪动的任务，则不需要对当前ActivityStack进行调整;

然后，确定目标任务在当前ActivityStack中，则对ActivityStack进行调整，将目标任务插入ActivityStack栈顶。

  - **insertTaskAtTop()**，会先将已有的目标任务删除，再重新添加到栈顶位置;
  - **moveToFront()**，在第二步中执行过一次，因为在某些场景下，只会调用**moveToFront()**，不会调用**moveTaskToFrontLocked()**;
    一旦要将任务挪到ActivityStack栈顶，意味着ActivityStack也一定要挪到前台;

最后，将任务栈顶的Activity置为Resumed状态，这里是通过ActivityStackSupervisor完成的。因为可能同时存在多个显示设备，所以需要对多个ActivityStack进行操作。

> Activity管理中有两个栈顶：一是ActivityStack的栈顶，它对应到要显示的TaskRecord; 二是TaskRecord的栈顶，它对应到要显示的Activity。简单来说，当前显示的Activity一定是位于其所属的TaskRecord的栈顶，TaskRecord也一定位于其所属的ActivityStack的栈顶。


### ActivityDisplay

Android支持多屏显示，在不同的显示设备上可以有不同的ActivityStack。

笔者一直在重述：所有的ActivityStack都是通过ActivityStackSupervisor管理起来的。
在ActivityStackSupervisor内部，设计了ActivityDisplay这个内部类，它对应到一个显示设备，默认的显示设备是手机屏幕。
ActivityStackSupervisor间接通过ActivityDisplay来维护多个ActivityStack的状态。
ActivityStack有一个属性是mStacks，当mStacks不为空时，表示ActivityStack已经绑定到了显示设备，
其实ActivityStack.mStacks只是一个副本，真正的对象在ActivityDisplay中。

属性 | 描述
----- | -----
**mDisplayId** | 显示设备的唯一标识
**mDisplay** | 获取显示设备信息的工具类，
**mDisplayInfo** | 显示设备信息的数据结构，包括类型、大小、分辨率等
**mStacks** | 绑定到显示设备上的ActivityStack

行为 | 描述
----- | -----
**attachActivities()** | 将一个ActivityStack绑定到显示设备
**setVisibleBehindActivity()** | 设置后台显示的Activity
**moveHomeStack()** | 移动HomeStack


### ActivityContainer

在ActivityStackSupervisor中，还设计了名为ActivityContainer的内部类。
该类是对ActivityStack的封装，相当于开了一个后门，可以通过`adb shell am`命令对ActivityStack进行读写操作，方便开发和调试。

### ActivityStackSupervisor

ActivityStackSupervisor的职责是管理多个ActivityStack。

属性 | 描述
----- | -----
**mHomeStack** | 主屏(桌面)所在ActivityStack
**mFocusedStack** | 表示焦点ActivityStack，它能够获取用户输入
**mLastFocusedStack** | 上一个焦点ActivityStack
**mActivityDisplays** | 表示当前的显示设备，ActivityDisplay中绑定了若干ActivityStack。通过该属性就能间接获取所有ActivityStack的信息

行为 | 描述
----- | -----
**setFocusedStack()** | 设置当前的焦点ActivityStack
**adjustStackFocus()** |
**startHomeActivity()** | 启动桌面

ActivityStackSupervisor有很多与ActivityStack功能类似的行为，不过都是针对多个ActivityStack进行操作。
譬如**findTaskLocked()**， **findActivityLocked()**， **topRunningActivityLocked()**, **ensureActivitiesVisibleLocked()**等，




**`场景 1`** 在启动一个新的Activity时，需要设置当前的焦点，通过**AMS.setFocusedActivityLocked()**函数，就能设置一个
ActivityRecord为当前的焦点Activity：

{% highlight java %}
final void setFocusedActivityLocked(ActivityRecord r, String reason) {
    if (mFocusedActivity != r) {
        mFocusedActivity = r;
        ...
        mStackSupervisor.setFocusedStack(r, reason + " setFocusedActivity");
        if (r != null) {
            mWindowManager.setFocusedApp(r.appToken, true);
        }
        applyUpdateLockStateLocked(r);
    }
    ...
}
{% endhighlight %}

该函数的逻辑很简单，如果当前的焦点(mFocusedActivity)不是待显示的(r)，则需要更新焦点; 然后，就发起了其他函数调用。
这里，需要通过ActivityStackSupervisor完成对ActivityStack的管理，通过调用**setFocusedStack()**来设置当前的焦点Stack，
焦点Stack就是焦点Activity所属的ActivityStack。

{% highlight java %}
void setFocusedStack(ActivityRecord r, String reason) {
    if (r != null) {
        final TaskRecord task = r.task;
        // 判断输入的ActivityRecord是否为HomeActivity
        boolean isHomeActivity = !r.isApplicationActivity();
        if (!isHomeActivity && task != null) {
            isHomeActivity = !task.isApplicationTask();
        }
        if (!isHomeActivity && task != null) {
            final ActivityRecord parent = task.stack.mActivityContainer.mParentActivity;
            isHomeActivity = parent != null && parent.isHomeActivity();
        }
        moveHomeStack(isHomeActivity, reason);
    }
}
{% endhighlight %}

只有前台的ActivityStack才能获取焦点，所以，该函数的功能就是要将待显示的Activity所在的ActivityStack挪到前台。
很重要的一个处理逻辑就是判定待显示的ActivityRecord的类型是否为HomeActivity，判定细节此处不表。结果是：
如果待显示的ActivityRecord类型为HomeActivity，则需要将HomeStack挪到前台; 否则，意味着要将HomeStack挪到后台。
挪动HomeStack，是通过**moveHomeStack()**这个函数实现的：

{% highlight java %}
void moveHomeStack(boolean toFront, String reason) {
    // 1. 获取当前的Top Stack
    ArrayList<ActivityStack> stacks = mHomeStack.mStacks;
    final int topNdx = stacks.size() - 1;
    if (topNdx <= 0) {
        return;
    }
    ActivityStack topStack = stacks.get(topNdx);
    // 2. 判定HomeStack是否需要挪动
    final boolean homeInFront = topStack == mHomeStack;
    if (homeInFront != toFront) {
        mLastFocusedStack = topStack;
        stacks.remove(mHomeStack);
        stacks.add(toFront ? topNdx : 0, mHomeStack);
        mFocusedStack = stacks.get(topNdx);
    }
    ...
    // 3. 判定当前AMS是否完成启动
    if (mService.mBooting || !mService.mBooted) {
        final ActivityRecord r = topRunningActivityLocked();
        if (r != null && r.idle) {
            checkFinishBootingLocked();
        }
    }
}
{% endhighlight %}

1. 获取当前的Top Stack，其实就是获取mStacks这个数组最后的元素。mStacks这个属性在ActivityStack和ActivityDisplay中都见过，它们是同一个东西，ActivityStackSupervisor要管理的就是这个东西;

2. 判定当前HomeStack是否需要挪动。有四种情况：
	- homeInFront = true, toFront = false： 表示HomeStack在前台，要将其挪到后台，则需要将HomeStack挪到mStacks的0号位置;
	- homeInFront = true, toFront = true： 表示HomeStack在前台，要将其挪到前台，则不需要对mStacks进行调整;
	- homeInFront = false, toFront = true： 表示HomeStack在后台，要将其挪到前台，则需要将HomeStack挪到mStacks的末尾;
	- homeInFront = false, toFront = false： 表示HomeStack在后台，要将其挪到后台，则不需要对mStacks进行调整。

3. 判断当前AMS是否完成启动。如果当前是刚开机，AMS都还未启动完成，需要显示的Activity还处于idle状态，则需要发起一次是否启动完成的检查


### ProcessRecord

AMS采用ProcessRecord这个数据结构来维护进程运行时的状态信息，当创建系统进程(system_process)或应用进程的时候，就会通过AMS初始化一个ProcessRecord。

属性 | 描述
----- | -----
**BatteryStats** | 电量统计的接口
**ApplicationInfo** | 系统进程的ApplicationInfo是从android包中解析出来的数据; 应用程序的ApplicationInfo是从AndroidManifest.xml中解析出来的数据
**Process Name** | 进程名称
**UID** |  进程的UID。系统进程的UID是1000(Process.SYSTEM_UID); 应用进程的UID是从10000(Process.FIRST_APPLICATION_UID)开始分配的
**maxAdj, curAdj, setAdj** | 各种不同的OOM Adjustment值
**lastPss， lastPssTime** | 物理内存(PSS)相关，进程中有对象创建或销毁时，PSS相关的属性会被更新。
**activities, services, receivers** | 进程中的Android组件，随着进程的运行，这些信息都可能需要更新。譬如Activity的启动时，ProcessRecord.activies会增加一个实例; 销毁时，对将对应的实例从activities删除
**pkgList** | 进程中运行的包
**thread** | 该属性是IApplicationThread类型的对象

ProcessRecord有“**激活(Active)**”和“**非激活(Inactive)**”两种状态，只有将ProcessRecord绑定到一个实际进程的时候，才是激活状态。
绑定成功后，**thread**属性就被赋值，表示ProcessRecord已经激活。
激活后，AMS就可以通过这个接口完成对应用进程的管理，譬如启动Activity、派发广播等。
将ProcessRecord绑定到应用进程的过程在[Android四大组件之Activity--应用进程与系统进程的通信]()一文中有详细的分析。

行为 | 描述
----- | -----
**makeActive()** | 将ProcessRecord置成激活状态
**makeInactive()** | 将ProcessRecord置成非激活状态
**addPackage()** | 向ProcessRecord添加包



## 2.2 关联关系

<div align="center"><img src="/assets/images/activity/maintenace/2-activity-maintenace-relationship.png" alt="Maintenace Guideline"/></div>

- **AMS运行在SystemServer进程中。**SystemServer进程启动时，会通过SystemServer.startBootstrapServices()来创建一个AMS的对象;

{% highlight java %}
private void startBootstrapServices() {
    ...
    mActivityManagerService = mSystemServiceManager.startService(
        ActivityManagerService.Lifecycle.class).getService();
    ...
}
{% endhighlight %}

- **AMS通过ActivityStackSupervisor来管理Activity。**AMS对象只会存在一个，在初始化的时候，会创建一个唯一的ActivityStackSupervisor对象;

{% highlight java %}
public ActivityManagerService(Context systemContext) {
    ...
    mStackSupervisor = new ActivityStackSupervisor(this);
    ...
}
{% endhighlight %}

- **ActivityStackSupervisor中维护了显示设备的信息。**当有新的显示设备添加时，会创建一个新的ActivityDisplay对象;

{% highlight java %}
public void handleDisplayAddedLocked(int displayId) {
    ...
    newDisplay = mActivityDisplays.get(displayId) == null;
    if (newDisplay) {
        ActivityDisplay activityDisplay = new ActivityDisplay(displayId);
        ...
    }
    ...
}
{% endhighlight %}

- **ActivityStack与显示设备的绑定。**当需要创建一个ActivityStack时，需要将其绑定到具体的显示设备。
  ActivityStackSupervisor通过ActivityContainer这个内部类对ActivityStack进行了一层封装，
  所以，会首先创建一个ActivityContainer对象;然后，通过ActivityContainer.attachToDisplayLocked()函数进行具体的绑定操作;

{% highlight java %}
private int createStackOnDisplay(int stackId, int displayId) {
    ...
    ActivityContainer activityContainer = new ActivityContainer(stackId);
    mActivityContainers.put(stackId, activityContainer);
    activityContainer.attachToDisplayLocked(activityDisplay);
    return stackId;
}
{% endhighlight %}

- **AMS维护了所有进程的信息ProcessRecord。**当需要创建一个新的进程时，
  会通过AMS.newProcessRecordLocked()函数来创建一个ProcessRecord对象，
  ProcessRecord对象都保存在AMS.mPidsSelfLocked这个属性中;

{% highlight java %}
final ProcessRecord newProcessRecordLocked(ApplicationInfo info, String customProcess,
        boolean isolated, int isolatedUid) {
    ...
    return new ProcessRecord(stats, info, proc, uid);
}
{% endhighlight %}

- **通过ActivityStackSupervisor来创建ActivityRecord。**当SystemServer进程收到来自应用进程的启动Activity请求时，
  会通过ActivityStackSupervisor来创建一个ActivityRecord对象;

{% highlight java %}
final int startActivityLocked(IApplicationThread caller, ...) {
   ...
   ActivityRecord r  = new ActivityRecord(mService, callerApp, callingUid, callingPackage,
           intent, resolvedType, aInfo, mService.mConfiguration, resultRecord, resultWho,
           requestCode, componentSpecified, this, container, options);
   ...
}
{% endhighlight %}

- **在ActivityStack上创建TaskRecord。**当需要创建新的任务栈时，就会通过ActivityStack对象来创建一个TaskRecord对象，
  这样就建立了ActivityStack和TaskRecord的关联;

{% highlight java %}
TaskRecord createTaskRecord(int taskId, ActivityInfo info, Intent intent,
        IVoiceInteractionSession voiceSession, IVoiceInteractor voiceInteractor,
        boolean toTop) {
    TaskRecord task = new TaskRecord(mService, taskId, info, intent, voiceSession,
            voiceInteractor);
    addTask(task, toTop, false);
    return task;
}
{% endhighlight %}

- **ActivityRecord的宿主TaskRecord。**每一个ActivityRecord都需要找到自己的宿主TaskRecord，通过ActivityRecord.setTask()函数
  就能建立ActivityRecord和TaskRecord的关联;

{% highlight java %}
void setTask(TaskRecord newTask, TaskRecord taskToAffiliateWith) {
    ...
    task = newTask;
    setTaskToAffiliateWith(taskToAffiliateWith);
}
{% endhighlight %}

- **进程中运行的Activity信息。**Activity在应用进程中运行，AMS中记录了进程中所有运行的Activity的信息，在ActivityRecord创建后，
  会通过ProcessRecord.addPackage()函数，在ProcessRecord中登记ActivityRecord的信息

{% highlight java %}
void startSpecificActivityLocked(ActivityRecord r,
        boolean andResume, boolean checkConfig) {
    ProcessRecord app = mService.getProcessRecordLocked(r.processName,
            r.info.applicationInfo.uid, true);
    ...
    app.addPackage(r.info.packageName, r.info.applicationInfo.versionCode,
    ...
}
{% endhighlight %}

# 3. Activity管理的延伸

在分析完Activity管理的基础数据结构及关联关系后，想必各位读者已经感受到了Activity管理的复杂性。
如此庞大而精密的数据结构设计，是在什么背景下产生的呢？从已有的Activity设计中，
能否窥探出以后Android在Activity相关特性的发展方向呢？譬如多屏幕、多窗口的Activity显示。

笔者一直认为，研究Android源码不仅仅是理解Android的内部运行机制，更重要的是体会出其背后的设计思想，
总结出一套解决同类问题的方法论，然后再到具体的软件开发中进行实践，哪怕不在Android平台下开发，
提炼出来的方法论仍然是受用的。

## 3.1 设计思想

- TaskRecord是一个栈，ActivityStack也是一个栈，Android这么设计有什么好处吗？

---

**参考资料**

1. 
