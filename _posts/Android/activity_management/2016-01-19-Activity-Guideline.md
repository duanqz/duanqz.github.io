---
layout: post
category: Android启智观
title: Android四大组件之Activity
tagline:
tags:  Activity管理机制
---

在Android四大组件中，Activity是最重要也是最复杂的，为了厘清Activity的内在运行机制，
笔者从以下几个方面来分析Activity：

1. **[Activity的四种启动模式](2016-01-21-Activity-LaunchMode)**

	作为一个Android开发人员，这四种Activity启动模式或许耳熟能详，但其使用场景，未必大家都有所了解，
  之所以要设计出不同的启动模式，是因为要应对不同的用户交互场景，以便达到更好的体验。
  这一节介绍四种启动模式对Activity的影响以及常见的使用场景。

	- standard(MULTIPLE): 默认的Activity启动模式
	- singleTop
	- singleTask
	- singleInstance

2. **[ActivityManagerService的启动过程](2016-07-15-AMS-LaunchProcess)**

	ActivityManagerService是Android四大组件的管理中心，是Android中非常非常重要的系统服务。
	本文介绍ActivityManagerService的启动过程。

	- SystemServer
	- SystemService
	- ServiceManager
	- ActivityManagerService

3. **[Activity的管理方式](2016-02-01-Activity-Maintenance)**

	Activity管理最重要的数据结构是栈，Android设计了多层栈结构来维护Activity。
	这一节介绍Activity相关的各种数据结构。

	- Activity
	- ActivityInfo
	- ActivityRecord
	- TaskRecord
	- ActivityStack

4. **[应用进程与系统进程的通信](2016-01-29-Activity-IPC)**

	应用进程需要频繁与系统进程通信，譬如Activity生命周期的各个方法都是需要经过系统进程调度的，这就需要从系统到应用的跨进程调用;
	应用进程有需要将当前Activity的状态告诉系统进程，以便系统将Activity驱动到下一个状态，这就需要从应用到系统的跨进程调用。
	这一节介绍应用进程与系统进程的通信接口实现以及跨进程数据绑定过程。

	- IActivityManager
	- IApplicationThread
	- IApplicationToken
	- ActivityThread

5. **[Activity的启动过程(上)](2016-07-29-Activity-LaunchProcess-Part1)**

	Activity的启动过程涉及到的逻辑非常庞大，贯穿了整个Activity的管理结构，与进程启动也息息相关。
	这一节将以HomeActivity的启动时序为主线，详解在系统进程中经历所经历的Activity启动过程。

	- ActivityStack
	- ActivityStackSupervisor
	- ActivityManagerService

6. **[Activity的启动过程(下)](2016-10-23-Activity-LaunchProcess-Part2)**

	Activity的启动过程经过了系统进程的层层磨难，又会进入到一个系统进程与应用进程相互通信的阶段，两个进程合力完成Activity的启动过程。
	这一节将仍然以启动时序为主线，不过会涉及到两个进程之间的通信。

	- IApplicationThread
	- ActivityThread
	- ActivityManagerService
