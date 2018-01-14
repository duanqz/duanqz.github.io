---
layout: post
category: Android启智观
title: Android Bluetooth LE开发实例
tagline:
tags:  [蓝牙, BLE, Bluetooth LE]
---

在物联网蠢蠢欲动的时代，手机作为控制中心管控各类终端设备已经非常普遍，很多小家电(电视机、电风扇、电饭煲、电灯等)都支持将手机作为遥控器，这些终端设备一般都良好支持NFC、Bluetooth或WIFI协议。随着Android版本的演进，对各种通信协议栈的支持也越发完善，故笔者心血来潮，开发了一款的APP，用于蓝牙低功耗(Bluetooth Low Energy)设备的连接和调试，效果图如下：

<div align="center"><img src="/assets/images/context/1-bluetoothle-connector-app.png" /></div>

为描述方便，本文中的Bluetooth LE，BLE均指代蓝牙低功耗，即蓝牙4.0协议。

# 1. 蓝牙低功耗(BLE)简介

