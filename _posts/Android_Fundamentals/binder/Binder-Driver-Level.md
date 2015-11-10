---
layout: post
category: Android系统原理
title: Binder驱动
tagline:
tags:  [Android系统原理]
---
{% include JB/setup %}

# 1. 概览

[kernel/drivers/android/binder.c]()

binder_mmap() 分配物理内存

binder_update_page_range() 将进程的内核空间和用户空间针对同一块物理内存地址建立映射，这样，内核空间和用户空间就能访问这块共享的物理内存了


# 2. 数据结构

binder_proc: 

binder_node: BBinder

binder_ref: BpBinder

binder_buffer:

binder_thread:

binder_worker:

binder_transaction:

binder_ref_death:

flat_binder_object:

# 3. Binder机制层次结构

App层
AIDL机制

Java层
frameworks/base/core/java/android/os/IBinder.java
frameworks/base/core/java/android/os/BinderProxy.java
frameworks/base/core/java/android/os/Binder.java

frameworks/base/core/java/android/os/ServiceManager.java

JNI
frameworks/base/core/jni/android_util_binder.cpp

Native层
frameworks/native/include/binder/IBinder.h
frameworks/native/libs/binder/BpBinder.cpp
frameworks/native/libs/binder/Binder.cpp

system/core/libsysutils/src/ServiceManager.cpp



Driver层
kernel/$OEM/drivers/android/binder.c


