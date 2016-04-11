---
layout: post
category: Android系统原理
title: Android四大组件之Activity
tagline:
tags:  [Android四大组件]
---

在Android四大组件中，Activity是最重要也是最复杂的，为了厘清Activity的内在运行机制，
笔者从以下几个方面来分析Activity：

1. **[Activity的四种启动模式](/2016-01-21-Activity-LaunchMode)**

	作为一个Android开发人员，这四种Activity启动模式或许耳熟能详，但其使用场景，未必大家都有所了解，
    之所以要设计出不同的启动模式，是因为要应对不同的用户交互场景，以便达到更好的体验。
    这一节介绍四种启动模式对Activity的影响以及常见的使用场景。

	- standard(MULTIPLE): 默认的Activity启动模式
	- singleTop
	- singleTask
	- singleInstance

2. **[Activity的管理方式](/2016-02-01-Activity-Maintenance)**

	这一节介绍Activity相关的各种数据结构。

	- Activity
	- ActivityInfo
	- ActivityRecord
	- TaskRecord
	- ActivityStack

3. **[应用进程与系统进程的通信](2016-01-29-Activity-IPC)**

    应用进程需要频繁与系统进程通信，譬如Activity生命周期的各个方法都是需要经过系统进程调度的，这就需要从系统到应用的跨进程调用;
    应用进程有需要将当前Activity的状态告诉系统进程，以便系统将Activity驱动到下一个状态，这就需要从应用到系统的跨进程调用。
	这一节介绍应用进程与系统进程的通信接口实现以及跨进程数据绑定过程。

	- IActivityManager
	- IApplicationThread
	- IApplicationToken
	- ActivityThread

4. **[Activity的启动过程]()**

	- ActivityStack
	- ActivityStackSupervisor
	- ActivityManagerService