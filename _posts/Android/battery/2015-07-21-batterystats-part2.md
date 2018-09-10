---
layout: post
category: Android启智观
title: 电量统计(2)-日志
tagline: batterystats
tags:  [电量统计,日志分析]
---


在[电量统计(1)-原理](/2015-07-21-batterystats-part1)一文
中，我们分析了电量统计服务的运行机制、耗电量的计算方法。本文我们分析电量统计的输出日志，包括日志信息的格式、表示的意义等，这些日志信息能够帮助开发人员解决一些功耗和性能问题。

# 1. 耗电原因

# 2. 日志格式

Android提供的**dumpsys**命令用于查看系统服务的信息(实现原理可以查阅[dumpsys介绍](/2015-07-19-Intro-to-dumpsys))，
将**batterystats**作为参数，就能输出完整的电量统计信息。不同Android版本的日志格式不同, 版本越新, 日志信息越详尽. 但日志格式的主体框架一直没有变化.
以下截取的是在**Android 8.0**上的电量统计日志片段, 查看[完整日志](/assets/images/batterystats/dumpsys-batterystats.txt):

```sh
$ adb shell dumpsys batterystats
Battery History (69% used, 177KB used of 256KB, 62 strings using 5486):
                    0 (10) RESET:TIME: 2018-08-23-10-49-00
                    0 (2) 100 status=discharging health=good plug=none temp=282 volt=4397 charge=2838 +running +wake_lock +phone_scanning +screen phone_state=out brightness=dim top=u0a70:"com.test.mygame"
                    0 (2) 100 user=0:"0"
                    0 (2) 100 userfg=0:"0"
                    0 (2) 100 tmpwhitelist=1000:"keychain"
            +11s945ms (2) 100 -tmpwhitelist=1000:"keychain"
            +23s993ms (2) 100 brightness=dark
            +30s540ms (2) 100 -wake_lock -screen
            +30s608ms (3) 100 volt=4326 charge=2836 +wake_lock=1000:"ActivityManager-Sleep"
            ...
            +12d21h40m32s234ms (2) 012 -wake_lock stats=0:"dump"
            +12d21h40m41s694ms (3) 012 +wake_lock=1002:"bluetooth_timer" stats=0:"dump"
            +12d21h40m41s739ms (1) 012 -wake_lock

Discharge step durations:
  #0: +33m25s109ms to 11 (power-save-off, device-idle-off)
  #1: +4h17m48s90ms to 12 (screen-off, power-save-off, device-idle-off)
  ...
  #86: +4h30m0s79ms to 98 (screen-off, power-save-off, device-idle-off)
  Estimated screen off time: 14d 15h 56m 14s 500ms
...
```

这是在没有开WIFI,没有开数据网络的情况下,待机12天的电量统计. 下文中笔者将以这份日志为模板, 详细讲解日志各个部分所表达的涵义.


**dumpsys**命令带有很多参数, 其中一个参数是checkin, 表示输出适合机器解析的格式, 这样可以提升日志的解析效率. 默认不带checkin参数, 则整个日志是人可读的格式, 整个日志一共可以分为几大块:

<div align="center"><img src="/assets/images/batterystats/4-batterystats-structure.png" alt="日志结构"/></div>

- **Battery History**: 耗电统计的历史记录, 每一条记录以HistoryItem的形式存在
- **Per-PID Stats**: 每个进程唤醒工作的时间
- **Discharge step durations**: 每掉一隔电的时间点和设备的状态
- **Daily stats**: 以天为单位展示每掉一隔电的时间点和设备状态
- **Statistics since last charge**: 从上次充电以来的统计详情, 包含很多子板块
  - **Cellular Statistics**: 移动数据网络状态和使用情况
  - **Wifi Statistics**: WIFI的网络状态和使用情况
  - **Bluetooth**: 蓝牙在不同工作状态下的使用情况
  - **Estimated power use (mAh)**: 很重要的信息, 近似计算出的各个用户(uid)的耗电量, 一个APK通常对应到一个用户, 当然, 也有多个APK共享一个用户的情况
  - **All kernel wake locks**: Kernel Wakelock的使用情况
  - **All partial wake locks**: 应用层Wakelock的使用情况
  - **All wakeup reasons**: 所有的唤醒原因
  - **uid**: 每一个uid下的进程以及使用硬件设备的情况

对整个日志文件的结构有一个粗略的了解后, 就可以开始逐个击破了.

## 2.1 Battery History

在手机通电后, 点亮屏幕, Activity进入显示状态, 蓝牙/WIFI状态发生变化等, 都会产生耗电, `batterystats`会**被动(push)**或**主动(pull)**的获取电量统计信息, 每一次都会将获取到的信息记录下来, 每一条信息会以HistoryItem对象的形式保存在一个缓冲区. 整个**Battery History**的日志结构如下图所示:

<div align="center"><img src="/assets/images/batterystats/5-batterystats-history.png" alt="Battery History"/></div>

HistoryItem可以理解为一次记录耗电变化的动作, 因此, 它被设计为命令的方式, 每生成一个HistoryItem, 就相当于发起了一次耗电统计的命令. HistoryItem详细的描述了在某一个时刻,影响耗电的各因素所在的状态, 是分析功耗问题重要的依据. 随着待机时间的延长, HistoryItem对象的数量就越多, 因此, 整个电量统计日志可能很大篇幅都被**Battery History**占据了,下面就详细地剖析其中意义.

**第一行**

```sh
Battery History (69% used, 177KB used of 256KB, 62 strings using 5486):
```

用于存储HistoryItem的缓存并非无限大, Android默认为256KB,此处使用了177KB,所以使用率为69%. 另外, 因为日志中频繁出现的也是一些固定的字符串, 为了节省空间, 统计信息都是以极简的格式存储, 所以, 此处还有一个字符串的缓存. 

**第二行**

```sh
0 (10) RESET:TIME: 2018-08-23-10-49-00
```

这是第一条HistoryItem记录: RESET命令. RESET表示重新开始一个时间段的电量统计. 为什么需要RESET呢? 因为在统计之前可能是充电状态, 停止充电后才有统计的必要.

- 0: 表示当前开始统计的起点时间
- (10): 从缓存中读取的子节数
- RESET命令, 该处可能出现的另外命令还有START(开机时的统计记录), SHUTDOWN(关机时的统计记录), OVERFLOW(缓冲区溢出的记录).
  RESET和START命令会打印出当前的时间, 即TIME: 2018-08-23-10-49-00

**第三行**

```sh
0 (2) 100 status=discharging health=good plug=none temp=282 volt=4397 charge=2838 +running +wake_lock +phone_scanning +screen phone_state=out brightness=dim +top=u0a70:"com.test.mygame"
```

这是第二条HistoryItem记录: 

- 100 当前电量百分值,随着时间的推移,这个值会逐渐减少
- status: 充电状态(unknown未知状态, charging充电状态, discharging放电状态, not-charging没有充电, full已充满)
- health: 电池状态(unknown未知状态, good正常, overheat过热, dead已坏, over-voltage电压过高, cold过冷)
- plug: 插拔连接状态(none未插拔, ac交流电, usb数据线, wireless无线连接)
- temp: 电池温度
- volt: 电池电压
- state: 主动记录的影响耗电的硬件工作状态, 这些状态从字面意思就能理解
  - 部分状态前面会带上`+`或者`-`, `+`表示进入状态, `-`表示离开状态, 譬如: +running表示CPU进入运行状态, -wakelock表示释放锁
  - 部分状态设置了状态值. 譬如: phone_signal_strength=great表示当前手机信号很强
- wakeup_reason: 如果存在,则会打印唤醒的理由
- event: 被动通知的影响耗电的事件, event会带上事件源的uid
  - 部分事件前面会带上`+`或者`-`, `+`表示进入事件, `-`表示离开事件, 譬如: +top=u0a70:"com.test.mygame"表示当前进入显示的界面为com.test.mygame, 事件源的uid为u0a70
  - 所有事件都有一个描述值, 即`=`右边的内容

**第四行, 第五行**

```sh
0 (2) 100 user=0:"0"
0 (2) 100 userfg=0:"0"
```

这是第三条和第四条HistoryItem记录, 分别记录了两个事件(event), Android系统进程启动完成时会通知`batterystats`: 记录当前的系统用户(USER_SYSTEM, 默认编号是0)

**第六行, 第七行 ...**

```sh
        0 (2) 100 tmpwhitelist=1000:"keychain"
+11s945ms (2) 100 -tmpwhitelist=1000:"keychain"
+23s993ms (2) 100 brightness=dark
+30s540ms (2) 100 -wake_lock -screen
+30s608ms (3) 100 volt=4326 charge=2836 +wake_lock=1000:"ActivityManager-Sleep"
+30s661ms (1) 100 -wake_lock
+30s882ms (2) 100 +wake_lock=1000:"startDream"
+31s259ms (1) 100 -wake_lock
+33s387ms (3) 100 volt=4369 wake_reason=0:"Abort:Callback failed on alarmtimer in platform_pm_suspend+0x0/0x50 returned -16"
+35s008ms (2) 100 +wake_lock=u0a21:"*walarm*:com.android.internal.policy.impl.PhoneWindowManager.DELAYED_KEYGUARD"
+35s217ms (1) 100 -running -wake_lock
...
```

剩下的HistoryItem记录, 用时间序记录了耗电过程, 整个过程其实就是**硬件状态**和**耗电事件**交替发生变化. 随着时间的推移, 系统在睡眠中会被唤醒, CPU开始运转, 蓝牙可能开始工作, 不良应用可能持锁不放导致系统无法休眠, 这些都直接反映到了上述日志中. 



## 2.2 Per-PID Stats