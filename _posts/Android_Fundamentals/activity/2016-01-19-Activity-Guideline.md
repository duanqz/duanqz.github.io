---
layout: post
category: Android系统原理
title: Android四大组件之Activity
tagline:
tags:  [Android四大组件]
---
{% include JB/setup %}

在Android四大组件中，Activity是最重要也是最复杂的，为了厘清Activity的内在运行机制，
笔者从以下几个方面来分析Activity：

1. **Activity的四种启动模式**

	- Standard
	- SingleTop
	- SingleTask
	- SingleInstance

2. **Activity的管理方式**

	- Activity
	- ActivityInfo
	- ActivityRecord
	- TaskRecord
	- ActivityStack

3. **应用进程与系统进程的通信**

	- IApplicationToken
	- IActivityManager
	- IApplicationThread
	- ActivityThread
	- ActivityManangerService

4. **Activity的启动过程**

	- ActivityStack
	- ActivityStackSupervisor
	- ActivityManagerService