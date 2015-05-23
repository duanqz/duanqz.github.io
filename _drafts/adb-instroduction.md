---
layout: post
category : adb
tagline: "Android Debug Bridge"
tags : []
---
{% include JB/setup %}

## ADB的三个组成元素

- adb clients
  在本地客户端的可执行程序，通过下载Android SDK可以获取。可以执行`adb shell`, `adb logcat`等命令

- adb server
  在本地服务的执行， 通常占用本地的`5037`端口。作为adb clients和adbd的通信代理
  
- adb daemon(adbd)
  在实际的手机上执行。当Android系统起机的时候，由init启动adbd。如果adbd挂了，则会由init重新启动。
  
## adb server何时启动

- adb clients和server是共用同一个执行程序的，即`adb`。

- 当我们执行一些常用的adb命令时，譬如adb devices，adb server就自动启动了。
  也可以通过adb start-server来启动
  
- 如果想要停止server的运行，可以通过adb kill-server来杀掉server进程

# USB Vendor ID

当通过USB线连接手机时，adb需要检查手机厂商的ID，即Vendor ID。
adb已经内置了很多Vendor ID，但仍然不能涵盖所有的手机厂商。

当出现adb无法找到设备时，我们需要手工添加Vendor ID：

  $HOME/.android/adb_usb.ini

在上述文件中，添加一行即可。

如何知道手机厂商的Vendor ID是多少呢？ 通过`lsusb`命令可以查看。

## 几条有趣的adb命令

    adb hell

    adb lolcat
