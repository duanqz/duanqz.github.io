---
layout: post
category: Android系统原理
title: Android四大组件之Activity--启动过程(下)
tagline:
tags:  [Android四大组件]
---

在[Activity的启动过程(上)](2016-07-29-Activity-LaunchProcess-Part1)一文中，我们介绍了Activity启动过程的上半部分，
按照Activity的启动时序，涉及内容到多达11个函数，最终落脚点在创建一个应用进程。Activity启动过程的上半部分都还是在系统进程中完成，
都是系统进程内部数据结构和状态的调整。本文分析Activity启动过程的下半部分，涉及到系统进程和应用进程的通信，建议读者先读完[应用进程与系统进程的通信](2016-01-29-Activity-IPC)，了解两个进程的通信方式。

本文还是像Activity启动过程(上)一样，以Activity的启动时序为主线，以函数为段落进行分析。

# 概览

当Zygote创建完一个应用进程之后，得到的仅仅是一个可以运行的载体，Android还没有侵入到这个新创的进程之中。在[ActivityManagerService的启动过程](2016-07-15-AMS-LaunchProcess.md)一文中，我们介绍过，当系统进程创建以后，还需要创建一个运行环境，就是Context，然后再装载Provider信息，这才是一个可以完整的Android进程。对于应用进程而言，也需要经历这个过程。

先上最上层的时序图：

<div align="center"><img src="/assets/images/activity/launchprocess/4-activity-launchprocess-sequence-diagram.png" alt="Sequence Diagram"/></div>
