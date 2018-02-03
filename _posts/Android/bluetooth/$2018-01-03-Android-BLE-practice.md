---
layout: post
category: Android启智观
title: Android Bluetooth LE开发实例
tagline:
tags:  [蓝牙, BLE, Bluetooth LE]
---

在物联网蠢蠢欲动的时代，手机作为控制中心管控各类终端设备已经非常普遍，很多家电(电视机、电风扇、电饭煲、电灯等)都支持将手机作为遥控器，这些终端设备一般都良好支持NFC、Bluetooth或WIFI协议。随着Android版本的演进，对各种通信协议栈的支持也越发完善，故笔者心血来潮，开发了一款的APP，用于蓝牙低功耗(Bluetooth Low Energy)设备的连接和调试，效果图如下：

<div align="center"><img src="/assets/images/context/1-bluetoothle-connector-app.png" /></div>

为描述方便，本文中的Bluetooth LE、BLE均指代蓝牙低功耗，即蓝牙4.0协议。

# 1. 蓝牙低功耗(BLE)简介

# 2. 架构

“单Activity，多Fragment”

```
    // 控件相关
    compile 'com.android.support:appcompat-v7:25.3.1'
    compile 'com.android.support:design:25.3.1'
    compile 'com.android.support:cardview-v7:25.3.1'

    // 基于RxJava实现了RxBus
    compile 'io.reactivex.rxjava2:rxandroid:2.0.1'
    compile 'io.reactivex.rxjava2:rxjava:2.1.2'

    // 基于JDK的Bluetooth Gatt Parser：https://github.com/sputnikdev/bluetooth-gatt-parser
    // 本例将其移植到了Android，能够支持各种Bluetooth Profile的解析
    compile 'org.slf4j:slf4j-android:1.7.25'
    compile 'com.thoughtworks.xstream:xstream:1.4.7', {
        exclude group: 'xmlpull', module: 'xmlpull'
    }
    compile 'commons-beanutils:commons-beanutils:1.9.3', {
        exclude group: 'commons-logging', module: 'commons-logging'
    }
```