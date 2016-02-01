---
layout: post
category: Android系统原理
title: Activity管理
tagline:
tags:  [Activity]
---
{% include JB/setup %}

# 1. 概要

# 数据结构相关



## ProcessRecord




## Activity

应用程序通过Activity来呈现用户界面，它定义了界面布局、启动方式、生命周期内的行为。




## ActivityInfo

**taskAffinity**：




## ActivityRecord

如果Activity是个静态的概念，那么ActivityRecord可以理解为的Activity的动态表示，
既然是动态的，那自然就会关联到一些进程运行时相关的属性。

ActivityRecord是AMS调度Acitivity的基本单位，ActivityRecord组成了TaskRecord，TaskRecord又组成了ActivityStack。

packageName:
processName:

ActivityInfo info

ApplicationInfo appInfo

IApplicationToken token

ActivityRecord resultTo




## TaskRecord

intent: 启动TaskRecord的intent

**mActivities**: Task中所有ActivityRecord的数组。TaskRecord是一个ActivityRecord栈，内部的数据结构就是这个数组，
这个栈有**根部(Root)**和**顶部(Top)**。

**stack**: ActivityRecord所在的ActivityStack。将TaskRecord添加到一个ActivityStack中时，这个属性就会被设置成宿主ActivityStack。

**taskId**： 唯一标识当前的Task。taskId统一由ActivityStackSupervisor分配，从0开始累加。

**affinity**：这个单词的中文意思是姻亲，表示关系很密切。对于一个TaskRecord而言，这个属性是一个标识。
每一个Activity都有一个taskAffinity属性，可以通过AndroidManifest.xml中的android:taskAffinity设定，默认情况下<activity>标签会从<application>标签继承android:taskAffinity，如果<application>标签中也没有指定的话，那taskAffinity就是应用程序的包名。

当一个Activity需要启动时，会寻找一个与其taskAffinity值相同的TaskRecord。

**rootAffinity**：第一次启动TaskRecord时，所赋予的affinity，这个值是不变的。

**ActivityStack.getTopActivity()**

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
{% endhighlight %}

该函数返回当前TaskRecord的栈顶ActivityRecord：从栈顶往下开始寻找，第一个不处于finishing状态的ActivityRecord就是了。

**TaskRecord.moveActivityToFrontLocked()**

{% highlight java %}
final void moveActivityToFrontLocked(ActivityRecord newTop) {
    mActivities.remove(newTop);
    mActivities.add(newTop);
    updateEffectiveIntent();
    setFrontOfTask();
}
{% endhighlight %}

该函数将一个ActivityRecord移至TaskRecord的顶部，实现方法就是先删除已有的，再在栈顶添加一个新的，
完后，需要重新调整一下栈根部的ActivityRecord，通过**TaskRecord.setFrontOfTask()**

{% highlight java %}
final void setFrontOfTask() {
    boolean foundFront = false;
    final int numActivities = mActivities.size();
    for (int activityNdx = 0; activityNdx < numActivities; ++activityNdx) {
        final ActivityRecord r = mActivities.get(activityNdx);
        if (foundFront || r.finishing) {
            r.frontOfTask = false;
        } else {
            r.frontOfTask = true;
            foundFront = true;
        }

    if (!foundFront && numActivities > 0) {
        mActivities.get(0).frontOfTask = true;
    }
}
{% endhighlight %}

ActivityRecord有一个属性是frontOfTask，表示ActivityRecord是否为TaskRecord的根Activity。
该函数设置TaskRecord中所有ActivityRecord的frontOfTask属性，从栈底往上开始遍历，第一个不处于finishing状态的ActivityRecord的
frontOfTask属性置成true，其他都为false。





## ActivityStack

管理一个Activity栈

Activity的状态

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

mTaskHistory: 所有Activity的TaskRecord数组

mPausingActivity：在发生Activity切换时，正处于Pausing状态的Activity

mResumedActivity：当前处于Resumed状态的ActivityRecord

mStacks：

ActivityStackHandler：绑定了AMS线程的消息队列。

**ActivityStack.findTaskLocked()**

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


**ActivtyStack.moveToFront()**

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

该方法用于将ActivityStack移植前台。**ActivityStack.isAttached()**用于判断当前的ActivityStack是否已经绑定到

{% highlight java %}
final void moveTaskToFrontLocked(TaskRecord tr, ActivityRecord source, Bundle options,
    String reason) {
    ...
    insertTaskAtTop(tr);
    moveToFront(reason);
    ...
    mStackSupervisor.resumeTopActivitiesLocked();
    EventLog.writeEvent(EventLogTags.AM_TASK_TO_FRONT, tr.userId, tr.taskId);
}
{% endhighlight %}

该方法用于显示一个Activity，经过以下几个关键步骤：

- 将TaskRecord置于ActivityStack的栈顶
- 将当前的ActivityStack移至前台
- 

{% highlight java %}
final void startActivityLocked(ActivityRecord r, boolean newTask,
    boolean doResume, boolean keepCurTransition, Bundle options) {
    TaskRecord rTask = r.task;
    final int taskId = rTask.taskId;
    // 1. 判定是否将新的TaskRecord放至栈顶
    if (!r.mLaunchTaskBehind && (taskForIdLocked(taskId) == null || newTask)) {
        insertTaskAtTop(rTask);
        mWindowManager.moveTaskToTop(taskId);
    }
    // 2. 判定是否在已有的TaskRecord中启动Activity
    if (!newTask) {
        ...
        for (int taskNdx = mTaskHistory.size() - 1; taskNdx >= 0; --taskNdx) {
            task = mTaskHistory.get(taskNdx);
            ...
            if (task == r.task) {
                if (!startIt) {
                    ...
                    task.addActivityToTop(r);
                    r.putInHistory();
                    mWindowManager.addAppToken(task.mActivities.indexOf(r), r.appToken,
                        r.task.taskId, mStackId, r.info.screenOrientation, r.fullscreen,
                        (r.info.flags & ActivityInfo.FLAG_SHOW_ON_LOCK_SCREEN) != 0,
                        r.userId, r.info.configChanges, task.voiceSession != null,
                        r.mLaunchTaskBehind);
                    return;
                 }
                 break;
            } else if (task.numFullscreen > 0) {
                startIt = false;
            }
        }
    }

    // 3. 将ActivityRecord置入宿主TaskRecord栈顶
    task = r.task;
    task.addActivityToTop(r);
    task.setFrontOfTask();
    r.putInHistory();

    // 4. 判定是否显示Activity切换的动画
    if (!isHomeStack() || numActivities() > 0) {
       ...
    } else {
       ...
    }

    // 5. 显示ActivityRecord
    if (doResume) {
        mStackSupervisor.resumeTopActivitiesLocked(this, r, options);
    }
}
{% endhighlight %}

1. 这里有两个判定条件，如果满足其中之一，则将新的TaskRecord放至栈顶

   - 需要后台启动Activity，而且栈中找不到宿主TaskRecord
   - newTask为true，表示需要在一个新的TaskRecord中启动Activity

2. 走到这一步，有三种可能：

   - 需要后台启动Activity
   - 栈中找不到宿主TaskRecord
   - newTask为flase

   这里有一个startIt的判定逻辑，如果TaskRecord中有覆盖全屏的Activity，则startIt为fasle。
   只有在startId为false时，才将ActivityRecord加入宿主TaskRecord的栈顶。这是什么一种场景呢？
   当需要新启动一个Activity，而且Activity的宿主TaskRecord处于不可见状态(被另一个TaskRecord栈中的全屏Activity遮挡了)，
   这时候，只需要将ActivityRecord置入宿主TaskRecord的栈顶即可，当宿主TaskRecord再次回到可见状态时，这个ActivityRecord就可见了;

3. 走到这一步，就意味着宿主TaskRecord已经准备好了，准备要正式启动Activity了，需要将ActivityRecord置入宿主TaskRecord的栈顶;

4. 根据ActivityStack当前的状态，来设置Activity切换的动画，具体逻辑此处不表;

5. 调用**ActivityStackSupervisor.resumeTopActivitiesLocked()**，将ActivityRecord置于显示状态。


**ActivityStack.resumeTopActivityInnerLocked()**这个函数的逻辑非常庞大，我们分成几个部分来看：

{% highlight java %}
final boolean resumeTopActivityInnerLocked(ActivityRecord prev, Bundle options) {
}
{% endhighlight %}

## ActivityStackSupervisor

作为ActivityStack的管理者，

维护几个ActivityStack：

- mHomdStack: Launcher的ActivityStack
- mFocusStack：当前具有焦点的ActivityStack
- mLastFocusStack：

维护Activity的状态：

- mWaitingVisibleActivities： 待显示的ActivityRecord数组
- mStoppingActivities：待Stop的ActivityRecord数组，数组中的ActivityRecord下一个状态是Stoped.
- mFinishingActivities：
- mGoingToSleepActivities：


**ActivityStackSupervisor.startActivityLocked()**

{% highlight java %}
final int startActivityLocked(IApplicationThread caller,
        Intent intent, String resolvedType, ActivityInfo aInfo,
        IVoiceInteractionSession voiceSession, IVoiceInteractor voiceInteractor,
        IBinder resultTo, String resultWho, int requestCode,
        int callingPid, int callingUid, String callingPackage,
        int realCallingPid, int realCallingUid, int startFlags, Bundle options,
        boolean componentSpecified, ActivityRecord[] outActivity, ActivityContainer container,
        TaskRecord inTask) {
    // 1. 初始化函数返回值为START_SUCCESS
    int err = ActivityManager.START_SUCCESS;

    // 2. 设置callingPid和callingUid
    ProcessRecord callerApp = null;
    if (caller != null) {
        callerApp = mService.getRecordForAppLocked(caller);
        if (callerApp != null) {
            callingPid = callerApp.pid;
            callingUid = callerApp.info.uid;
        } else {
            Slog.w(TAG, "Unable to find app for caller " + caller
                + " (pid=" + callingPid + ") when starting: "
                + intent.toString());
            err = ActivityManager.START_PERMISSION_DENIED;
        }
    }

    // 3. 设置sourceRecord和resultRecord
    ActivityRecord sourceRecord = null;
    ActivityRecord resultRecord = null;
    if (resultTo != null) {
        sourceRecord = isInAnyStackLocked(resultTo);
        if (sourceRecord != null) {
            if (requestCode >= 0 && !sourceRecord.finishing) {
                resultRecord = sourceRecord;
            }
        }
    }

    // 4. 根据FLAG_ACTIVITY_FORWARD_RESULT标识，对resultTo进行传递设置
    final int launchFlags = intent.getFlags();
    if ((launchFlags&Intent.FLAG_ACTIVITY_FORWARD_RESULT) != 0 && sourceRecord != null) {
        if (requestCode >= 0) {
            ActivityOptions.abort(options);
            return ActivityManager.START_FORWARD_AND_REQUEST_CONFLICT;
        }
        resultRecord = sourceRecord.resultTo;
        resultWho = sourceRecord.resultWho;
        requestCode = sourceRecord.requestCode;
        sourceRecord.resultTo = null;
        if (resultRecord != null) {
            resultRecord.removeResultsLocked(sourceRecord, resultWho, requestCode);
        }
        if (sourceRecord.launchedFromUid == callingUid) {
            callingPackage = sourceRecord.launchedFromPackage;
        }
    }

    // 5. 一系列的检查：是否为合法的包名、是否支持语音功能、是否具备权限等
    if (err == ActivityManager.START_SUCCESS && intent.getComponent() == null) {
        err = ActivityManager.START_INTENT_NOT_RESOLVED;
    }
    if (err == ActivityManager.START_SUCCESS && aInfo == null) {
        err = ActivityManager.START_CLASS_NOT_FOUND;
    }
    ...
    final int startAnyPerm = mService.checkPermission(START_ANY_ACTIVITY,
        callingPid, callingUid);
    final int componentPerm = mService.checkComponentPermission(aInfo.permission, callingPid,
        callingUid, aInfo.applicationInfo.uid, aInfo.exported);
    if (startAnyPerm != PERMISSION_GRANTED && componentPerm != PERMISSION_GRANTED) {
        ...
        throw new SecurityException(msg);
    }
    ...
    boolean abort = !mService.mIntentFirewall.checkStartActivity(intent, callingUid,
        callingPid, resolvedType, aInfo.applicationInfo);
    ...
    if (abort) {
        ...
        // 这里并没有真正启动Activity，但仍然返回了START_SUCCESS，
        ActivityOptions.abort(options);
        return ActivityManager.START_SUCCESS;
    }

    // 6. 正式启动一个新的ActivityRecord
    ActivityRecord r  = new ActivityRecord(mService, callerApp, callingUid, callingPackage,
        intent, resolvedType, aInfo, mService.mConfiguration, resultRecord, resultWho,
        requestCode, componentSpecified, this, container, options);
   ...
   err = startActivityUncheckedLocked(r, sourceRecord, voiceSession, voiceInteractor,
       startFlags, true, options, inTask);

   return err;
}
{% endhighlight %}

因为在启动一个新的Activity之前，需要进行一些必要的参数设定和检查，所以这个函数就承载了这些功能，它的最终目的是新建一个ActivityRecord。

1. 初始化函数返回值为START_SUCCESS，表示启动成功Activity，后续会根据实际情况重新赋值;

2. 根据caller对callingPid和callingUid赋值，caller是当前发起startActivity()的进程;

3. **resultTo**是IBinder类型的参数，它是远程ActivityRecord的标识，从ActivityA启动ActivityB，那么在ActivityB看来，
   ActivityA就是**resultTo**。什么是sourceRecord和resultRecord呢？

   - sourceRecord是从**resultTo**转化得到的实实在在的ActivityRecord，isInAnyStackLocked()方法会从当前所有的
     ActivityStack中检索**resultTo**，如果能够找到，就将其赋值给sourceRecord

   - 在调用Activity.startActivityForResult()启动一个Activity时，会给定一个requestCode(>=0)。
     这时候resultRecord就有了语义，表示之前的ActivityRecord需要当前Activity的返回结果，之前的ActivityRecord就是resultRecord

4. 如果设置了Intent的**FLAG_ACTIVITY_FORWARD_RESULT**参数，那表示要传递**resultTo**。
   譬如：AcitvityA启动ActivityB，ActivityB又启动了AcitivityC，
   在**FLAG_ACTIVITY_FORWARD_RESULT**的影响下，**resultTo**就从ActivityB传递到了ActivityA。
   此时，ActivityA中的**onActivityResult()**方法会得到响应。
   resultTo传递有一个条件，就是ActivityB在启动ActivityC时，不能设置requestCode;

5. 接下来，会经过一系列的检查，callingPid和callingUid这时候就派上用场了;

6. 如果前面的检查都能顺利通过，那么就走到了真正要启动Activity的流程了,在新建一个ActivityRecord后，就调用
   **ActivityStackSupervisor.startActivityUncheckedLocked()**，表示检查已经通过，要开始启动ActivityRecord了。

当所有的检查已经通过，就进入了**ActivityStackSupervisor.startActivityUncheckedLocked()**函数，
这个函数的逻辑非常庞大，我们分成几个部分来看。

{% highlight java %}
final int startActivityUncheckedLocked(ActivityRecord r, ActivityRecord sourceRecord,
    IVoiceInteractionSession voiceSession, IVoiceInteractor voiceInteractor, int startFlags,
    boolean doResume, Bundle options, TaskRecord inTask) {

    ...
    if (r.resultTo != null && (launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0) {
        r.resultTo.task.stack.sendActivityResultLocked(-1,
            r.resultTo, r.resultWho, r.requestCode,
            Activity.RESULT_CANCELED, null);
        r.resultTo = null;
    }
{% endhighlight %}

如果需要在一个新的Task中启动Activity，又需要返回结果给之前的Activity(resultTo != null)，那么就产生了冲突。
这种情况下，选择了放弃resultTo：通过**ActivityStack.sendActivityResultLocked()**函数，往应用进程发送**RESULT_CANCELED**消息，将resultTo置为null。

{% highlight java %}
    // 判断Intent是否发往已有的Top Activity
    if (r.packageName != null) {
        ActivityStack topStack = getFocusedStack();
        ActivityRecord top = topStack.topRunningNonDelayedActivityLocked(notTop);
        if (top != null && r.resultTo == null) {
            if (top.realActivity.equals(r.realActivity) && top.userId == r.userId) {
                if (top.app != null && top.app.thread != null) {
                    ...
                    top.deliverNewIntentLocked(callingUid, r.intent, r.launchedFromPackage);
                }
            }
        }
    }
    ...
{% endhighlight %}

- 如果当前Intent要启动的正好是Top Activity，那么就调用**ActivityRecord.deliverNewIntentLocked()**，将Intent发送给Top Activity

{% highlight java %}
    if (((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0 &&
        (launchFlags & Intent.FLAG_ACTIVITY_MULTIPLE_TASK) == 0)
        || launchSingleInstance || launchSingleTask) {
        if (inTask == null && r.resultTo == null) {
            ActivityRecord intentActivity = !launchSingleInstance ?
                findTaskLocked(r) : findActivityLocked(intent, r.info);
            if (intentActivity != null) {
                ...
                targetStack.moveToFront("intentActivityFound");
            }
        }
    }
{% endhighlight %}

{% highlight java %}
    if (newTask) {
        EventLog.writeEvent(EventLogTags.AM_CREATE_TASK, r.userId, r.task.taskId);
    }
    ActivityStack.logStartActivity(EventLogTags.AM_CREATE_ACTIVITY, r, r.task);
    targetStack.mLastPausedActivity = null;
    targetStack.startActivityLocked(r, newTask, doResume, keepCurTransition, options);
    if (!launchTaskBehind) {
        mService.setFocusedActivityLocked(r, "startedActivity");
    }
    return ActivityManager.START_SUCCESS;
}
{% endhighlight %}

- 最终判定需要启动一个新的TaskRecord来承载ActivityRecord。如果ActivityRecord不是在后台启动，还需要将其设置为当前焦点。



## ApplicationThread

## ActivityThread

应用进程的主线程

在收到LAUNCH_ACTIVITY消息后，

    ActivityThread.handleMessage(LAUNCH_ACTIVITY)
    └── ActivityThread.handleLaunchActivity()
        └── ActivityThread.performLaunchActivity()

**ActivityThread.performLaunchActivity()**

{% highlight java %}
private Activity performLaunchActivity(ActivityClientRecord r, Intent customIntent) {
    ...
    // 1. 新建Activity
    activity = mInstrumentation.newActivity(
                    cl, component.getClassName(), r.intent);
    ...
    // 2. 新建Application
    Application app = r.packageInfo.makeApplication(false, mInstrumentation);
    ...
    // 3. 为Activity绑定数据
     activity.attach(appContext, this, getInstrumentation(), r.token,
         r.ident, app, r.intent, r.activityInfo, title, r.parent,
         r.embeddedID, r.lastNonConfigurationInstances, config,
         r.referrer, r.voiceInteractor);
    ...
    // 4. 回调Activity.onCreate()
    if (r.isPersistable()) {
        mInstrumentation.callActivityOnCreate(activity, r.state, r.persistentState);
    } else {
        mInstrumentation.callActivityOnCreate(activity, r.state);
    }
    ...
    // 5. 启动Activity
    activity.performStart();
    ...
    if (r.isPersistable()) {
        mInstrumentation.callActivityOnRestoreInstanceState(activity, r.state,
            r.persistentState);
    } else {
        mInstrumentation.callActivityOnRestoreInstanceState(activity, r.state);
    }
    ...
    if (r.isPersistable()) {
        mInstrumentation.callActivityOnPostCreate(activity, r.state,
            r.persistentState);
    } else {
        mInstrumentation.callActivityOnPostCreate(activity, r.state);
    }

}
{% endhighlight %}

## ActivityManagerService


# 调用时序

## Activity启动

应用进程的调用栈

    Activity.startActivity()
    └── Activity.startActivityForResult()
        └── Instrumentation.execStartActivity()
            └── ActivityManagerProxy.startActivity()

    Binder.tansact()
    └── ActivityManagerNative.onTansact()

系统进程的调用栈

    ActivityManagerService.startActivity()
    └── ActivityManagerService.startActivityAsUser()
        └── ActivityStackSupervisor.startActivityMayWait()
            └── ActivityStackSupervisor.startActivityLocked()
                └── ActivityStackSupervisor.startActivityUncheckedLocked()

## Activity切换的函数调用栈

	ActivityManagerNative.onTransact()

    ActivityManagerService.activityPaused(token)
    // token是跨进程传递过来ActivityRecord的标识
    └── ActivityStack.activityPausedLocked()
        └── ActivityStack.completePauseLocked(true)
            // resumeNext=true，表示需要启动下一个ActivityRecord
            └── ActivityStackSupervisor.resumeTopActivitiesLocked(topStack, prev, null)
                // topStack表示当前处于栈顶的ActivityStack， prev表示之前的ActivityRecord
                └── ActivityStack.resumeTopActivityLocked(prev, null)
                    └── ActivityStack.resumeTopActivityInnerLocked()
                        ├── ApplicationThreadNative.scheduleResumeActivity()
                        │   └── Binder.transact()
                        │       // 发起跨进程调用，应用进程将会响应
                        │
                        └── ActivityStack.completeResumeLocked(next)
