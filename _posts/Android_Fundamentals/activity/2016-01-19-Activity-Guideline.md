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

1. **[Activity的四种启动模式](http://duanqz.github.io/android%E7%B3%BB%E7%BB%9F%E5%8E%9F%E7%90%86/2016/01/21/Activity-LaunchMode/)**

	- standard(MULTIPLE): 默认的Activity启动模式
	- singleTop
	- singleTask
	- singleInstance

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