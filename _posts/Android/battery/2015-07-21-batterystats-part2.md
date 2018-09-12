---
layout: post
category: Android启智观
title: 电量统计(2)-日志
tagline: battery
tags:  [电量统计,日志分析]
---


在[电量统计(1)-原理](/2015-07-21-batterystats-part1)一文中，我们分析了电量统计服务的运行机制、耗电量的计算方法。本文我们分析电量统计的输出日志，包括日志信息的格式、表示的意义等，这些日志信息能够帮助开发人员解决一些功耗和性能问题。

# 1. 耗电原因

为了更好的理解日志，读者需要对耗电有一个更为**量化**的理解。我们打开一个真实[power_profile.xml]({{ site.android_source }}/device/google/marlin/+/master/marlin/overlay/frameworks/base/core/res/res/xml/power_profile.xml)，这是Pixel这款手机的功耗配置文件，截取了其中几行：

```xml
<device name="Android">
  <item name="battery.capacity">3450</item>
  ...
  <item name="screen.on">178.708</item>
  <item name="screen.full">240.790</item>
  ...
</device>
```

Pixel这款手机的电池容量为3450mAh，亮屏时电流为178.708mA，亮度调节到最大时电流为240.790mA。这意味着，如果排除其他耗电影响，仅仅亮屏，该手机可以维持3450mAh➗178.708mA=19.305h(小时)；如果将屏幕亮度调到最大，该手机可以维持3450mAh➗240.790mA=14.327h(小时)。因此，电池容量越大，手机的续航时间一般更长；在手机重度使用的情况下，耗电会加快。

除了屏幕，手机上需要供电的模块还有很多：CPU、相机、闪光灯、音频、视频、蓝牙、modem、wifi、gps。按单位电流值排一个序的话：

```
相机(平均1152mAh) > modem(最高604mAh) > wifi(发数据370mAh) > CPU(最高频率290mAh) > 屏幕(最亮240mAh) > 音频(75mAh) > 视频(50mAh) > GPS(49mAh) > 蓝牙(8mAh)
```

将电池容量分成100隔的话，每隔电就是34.5mAh，既如果一个小时内用了34.5mA的电量，那就会掉一个隔电。参考这些电流值，可以很容易知道：手机拍照是很耗电的，使用数据流量看视频也是很耗电的，重度使用情况下，手机也就能使用2~3个小时。但如果手机一直处于休眠状态，CPU的单位电流值不到2mAh，这样待机个把月也是可以的。所以，一个正常的手机，电池是否耐用，是跟个人的使用习惯相关的。

我们平时分析的功耗问题，是在同等条件下的对比试验，找到异常耗电的原因。譬如：手机的初始条件相似(电池容量、相同的应用等)，在同样的环境下放置一个晚上，如果对比机出现明显的掉电异常，就可以通过电量日志找到异常耗电的原因。

# 2. 日志内容

Android提供的**dumpsys**命令用于查看系统服务的信息(实现原理可以查阅[dumpsys介绍](/2015-07-19-Intro-to-dumpsys))，
将**batterystats**作为参数，就能输出完整的电量统计信息。不同Android版本的日志格式不同，版本越新，日志信息越详尽。但日志格式的主体框架一直没有变化。
以下截取的是在**Android 8.0**上的电量统计日志片段，查看[完整日志](/assets/images/batterystats/dumpsys-batterystats.txt):

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

这是在没有开WIFI，没有开数据网络的情况下，待机12天的电量统计。下文中笔者将以这份日志为模板，详细讲解日志各个部分所表达的涵义。

**dumpsys**命令带有很多参数，其中一个参数是checkin，表示输出适合机器解析的格式，这样可以提升日志的解析效率。默认不带checkin参数，则整个日志是人可读的格式，整个日志一共可以分为几大块:

<div align="center"><img src="/assets/images/batterystats/4-batterystats-structure.png" alt="日志结构"/></div>

- **Battery History**: 耗电统计的历史记录，每一条记录以HistoryItem的形式存在
- **Per-PID Stats**: 每个进程唤醒工作的时间
- **Discharge step durations**: 每掉一隔电的时间点和设备的状态
- **Daily stats**: 以天为单位展示每掉一隔电的时间点和设备状态
- **Statistics since last charge**: 从上次充电以来的统计详情，包含很多子板块
  - **Cellular Statistics**: 移动数据网络状态和使用情况
  - **Wifi Statistics**: WIFI的网络状态和使用情况
  - **Bluetooth**: 蓝牙在不同工作状态下的使用情况
  - **Estimated power use (mAh)**: 近似计算出的各个用户(uid)的耗电量，一个APK通常对应到一个用户，当然，也有多个APK共享一个用户的情况
  - **All kernel wake locks**: 内核锁的使用统计
  - **All partial wake locks**: 应用锁的使用统计
  - **All wakeup reasons**: 所有的唤醒原因
  - **Statistics by uid**: 每一个uid的耗电细节

对整个日志文件的结构有一个粗略的了解后，就可以开始逐个击破了。

## 2.1 Battery History

`batterystats`会**被动(push)**或**主动(pull)**的获取电量统计信息，每一次都会将获取到的信息记录下来，每一条信息会以HistoryItem对象的形式保存在一个缓冲区。整个**Battery History**的日志结构如下图所示:

<div align="center"><img src="/assets/images/batterystats/5-batterystats-history.png" alt="Battery History"/></div>

HistoryItem可以理解为一次记录耗电变化的动作，因此，它被设计为命令的方式，每生成一个HistoryItem，就相当于发起了一次耗电统计的命令。HistoryItem详细的描述了在某一个时刻，影响耗电的各因素所在的状态，是分析功耗问题重要的依据。随着待机时间的延长，HistoryItem对象的数量就越多，因此，整个电量统计日志可能很大篇幅都被**Battery History**占据了，下面就详细地剖析其中意义。

**第一行**

```sh
Battery History (69% used, 177KB used of 256KB, 62 strings using 5486):
```

用于存储HistoryItem的缓存并非无限大，Android默认为256KB，此处使用了177KB，所以使用率为69%。另外，因为日志中频繁出现的也是一些固定的字符串，为了节省空间，统计信息都是以极简的格式存储，所以，此处还有一个字符串的缓存。

**第二行**

```sh
0 (10) RESET:TIME: 2018-08-23-10-49-00
```

这是第一条HistoryItem记录: RESET命令。RESET表示重新开始一个时间段的电量统计。为什么需要RESET呢? 因为在统计之前可能是充电状态, 停止充电后才有统计的必要。

- 0: 表示当前开始统计的起点时间
- (10): 从缓存中读取的子节数
- RESET命令，该处可能出现的另外命令还有START(开机时的统计记录)，SHUTDOWN(关机时的统计记录)，OVERFLOW(缓冲区溢出的记录)。
  RESET和START命令会打印出当前的时间，即TIME: 2018-08-23-10-49-00

**第三行**

```sh
0 (2) 100 status=discharging health=good plug=none temp=282 volt=4397 charge=2838 +running +wake_lock +phone_scanning +screen phone_state=out brightness=dim +top=u0a70:"com.test.mygame"
```

这是第二条HistoryItem记录: 

- 100 当前电量百分值，随着时间的推移，这个值会逐渐减少
- status: 充电状态(unknown未知状态，charging充电状态，discharging放电状态，not-charging没有充电，full已充满)
- health: 电池状态(unknown未知状态，good正常，overheat过热，dead已坏，over-voltage电压过高，cold过冷)
- plug: 插拔连接状态(none未插拔，ac交流电，usb数据线，wireless无线连接)
- temp: 电池温度
- volt: 电池电压
- state: 主动记录的影响耗电的硬件工作状态，这些状态从字面意思就能理解
  - 部分状态前面会带上`+`或者`-`，`+`表示进入状态，`-`表示离开状态，譬如: +running表示CPU进入运行状态，-wakelock表示释放锁
  - 部分状态设置了状态值。譬如: phone_signal_strength=great表示当前手机信号很强
- wakeup_reason: 如果存在，则会打印唤醒的理由
- event: 被动通知的影响耗电的事件，event会带上事件源的uid
  - 部分事件前面会带上`+`或者`-`，`+`表示进入事件，`-`表示离开事件，譬如: +top=u0a70:"com.test.mygame"表示当前进入显示的界面为com.test.mygame，事件源的uid为u0a70
  - 所有事件都有一个描述值，即`=`右边的内容

**第四行，第五行**

```sh
0 (2) 100 user=0:"0"
0 (2) 100 userfg=0:"0"
```

这是第三条和第四条HistoryItem记录，分别记录了两个事件(event)，Android系统进程启动完成时会通知`batterystats`: 记录当前的系统用户(USER_SYSTEM，默认编号是0)。

**第六行，第七行 ...**

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

剩下的HistoryItem记录，用时间序记录了耗电过程，整个过程其实就是**硬件状态**和**耗电事件**交替发生变化。随着时间的推移，系统在睡眠中会被唤醒，CPU开始运转，蓝牙可能开始工作，不良应用可能持锁不放导致系统无法休眠，这些都直接反映到了上述日志中。

## 2.2 Per-PID Stats

每个进程wakelock的持锁时间。

```sh
Per-PID Stats:
  PID 0 wake time: +7s20ms
  PID 885 wake time: +50s766ms
  PID 1528 wake time: +3s87ms
  PID 1313 wake time: +30s452ms
  PID 1931 wake time: +183ms
  PID 0 wake time: +1m12s327ms
  PID 885 wake time: +238ms
  PID 0 wake time: +2s33ms
  PID 885 wake time: +109ms
  PID 1357 wake time: +24s559ms
  PID 885 wake time: +46ms
  PID 885 wake time: +2s25ms
  PID 885 wake time: +117ms
```

日志中会看到一些重复的PID，因为这份日志是按照**uid**来归类的(但并没有把uid打印出来)，表达的是一个uid关联到的所有进程持有wakelock的时间。

## 2.3 Discharge step durations

每隔电的掉电时间和设备状态。

```
Discharge step durations:
  #0: +33m25s109ms to 11 (power-save-off, device-idle-off)
  #1: +4h17m48s90ms to 12 (screen-off, power-save-off, device-idle-off)
  ...
  #85: +4h40m0s170ms to 97 (screen-off, power-save-off, device-idle-off)
  #86: +4h30m0s79ms to 98 (screen-off, power-save-off, device-idle-off)
  Estimated screen off time: 14d 15h 56m 14s 500ms 
```

第#0条记录，表示用了33分25秒的时间，电量从12%已经掉到11%，手机此时的状态是：不在省电状态(power-save-off)，也不在空闲状态(device-idle-off)。
当然，在掉电的过程中，手机还可能处于其他状态：

- screen-on/scree-off：屏幕是否点亮。如果我们发现日志中，screen-on这个状态高频出现，那说明手机处于比较耗电的状态中。
- power-save-on/power-save-off：是否开启省电模式。在设置中，可以打开手机进入省电模式的开关，在省电状态下，手机会降低运行性能、禁止一些后台服务(譬如收邮件、定位等)。默认情况下，该开关是关闭的，既手机处于power-save-off的状态。
- device-idle-on/device-idle-off：是否处于空闲状态。从Android M(6.0)开始，就引入了Doze模式，简单来说，就是手机满足一定的条件(灭屏、静止、没有充电)时，就会进入到一种**休眠状态(IDLE)**，在这种状态下，所有CPU、网络、外设的使用请求都会被搁置。在深度休眠一段时间后，手机又会被唤醒，留出一小段**窗口期(IDLE_MAINTAINESS)**，执行之前搁置的请求。


## 2.4 Daily stats

以天为单位，展示每隔电的掉电时间和设备状态。这一部分日志的含义与上面相同，仅仅加了一个分类，不再赘述。

## 2.5 Statistics since last charge

自从上次充电以来的电量统计，既最近一次拔下充电线，仅仅使用手机电池的统计。这一部分日志是重点，包含很多方面的信息。

我们先来看整个耗电的统计概览：

```
  System starts: 0, currently on battery: false
  Estimated battery capacity: 2838 mAh
  Min learned battery capacity: 2838 mAh
  Max learned battery capacity: 2838 mAh
  Time on battery: 12d 21h 29m 48s 696ms (99.9%) realtime, 55m 40s 670ms (0.3%) uptime
  Time on battery screen off: 12d 21h 27m 48s 50ms (100.0%) realtime, 53m 40s 24ms (0.3%) uptime
  Time on battery screen doze: 0ms (0.0%)
  Total run time: 12d 21h 40m 42s 22ms realtime, 1h 6m 33s 995ms uptime
  Discharge: 2718 mAh
  Screen off discharge: 2712 mAh
  Screen doze discharge: 0 mAh
  Screen on discharge: 6.21 mAh
  Start clock time: 2018-08-23-10-49-00
  Screen on: 2m 0s 646ms (0.0%) 4x, Interactive: 1m 38s 319ms (0.0%)
  Screen brightnesses:
    dark 30s 383ms (25.2%)
    dim 1m 30s 263ms (74.8%)
  Total partial wakelock time: 57s 928ms
```

- System starts：手机重启次数，currently on battery：当前是否正在使用电池
- Estimated battery capacity：电池总容量
- **Time on battery**：电池使用时间。这个有两个时间：
  - **realtime**：正常流逝的时间，通常把这个时间叫做“墙上时间(walltime)”，就像挂在墙上的时钟一样，走过了一小时就是小时
  - **uptime**：CPU工作的时间。“墙上时间”经过一小时，但CPU可能就工作了一分钟，其他时间CPU都在休眠

  这两个时间结合在一起，就能够知道**休眠率**： `(realtime-uptime)/realtime`，既手机休眠的时间占整个待机时间的比率。休眠率越高，就表明越省电。
- **Time on battery screen off**：在灭屏状态下，电池的使用时间。通常，在灭屏时，我们希望手机可以快速进入休眠状态，所以，这里计算出的休眠率使我们考察耗电问题的重要指标
- Time on battery screen doze：在Doze状态下，电池的使用时间
- Total run time：总共的电池使用时间
- Discharge：放电量，既总共使用的电量
- Screen off discharge：灭屏状态下的放电量
- Screen doze discharge：Doze状态下的放电量
- Screen on discharge：亮屏状态下的放电量
- Start clock time：开始电量统计的时刻
- Screen brightnesses：屏幕在不同亮度下的时间
- **Total partial wakelock time**：应用层持有wakelock的总时间

在分析耗电问题时，需要综合考量这些指标。有几个重要的指标都已经高亮突出了，本例中的日志，休眠率高达99.7%，说明手机基本都在休眠，这也是可以待机12天的原因。

### 2.5.1 Cellular Statistics

射频模块(Radio Modem)的耗电统计，在使用数据网络时，就需要用到这个模块。

```
Cellular Statistics:
  Cellular kernel active time: 0ms (0.0%)
  Cellular data received: 0B
  Cellular data sent: 0B
  Cellular packets received: 0
  Cellular packets sent: 0
  Cellular Radio Access Technology: (no activity)
  Cellular Rx signal strength (RSRP):
    very poor (less than -128dBm):  12d 21h 29m 48s 696ms (100.0%) 
  Cellular Sleep time:  12d 19h 39m 12s 898ms (99.4%)
  Cellular Idle time:   15m 44s 852ms (0.1%)
  Cellular Rx time:     1h 34m 50s 946ms (0.5%)
  Cellular Tx time:     
    less than 0dBm:  0ms (0.0%)
    0dBm to 8dBm:  0ms (0.0%)
    8dBm to 15dBm:  0ms (0.0%)
    15dBm to 20dBm:  0ms (0.0%)
    above 20dBm:  0ms (0.0%)
```

- kernel active time：射频模块的kernel层活跃时间。如果长时间处于活跃，那会比较快的消耗电量
- data/packets received/sent：数据收发的大小和数据包的个数
- Radio Access Technology：接入的网络类型(none未插卡、umts、hspa、lte、hspap等)
- Rx signal strength：信号强度。如果长时间处于信号不好的情况，射频模块会提高功率，从而引起更大的耗电
- Sleep time/Idle time/Rx time/Tx time：射频模块分别处于休眠、空闲、接收数据、发送数据这几种不同状态下的时间

Wifi和Bluetooth的使用统计与Cellular大同小异，不再赘述。

### 2.5.2 Estimated power use

计算得到，不同硬件和应用的耗电情况排行。

```
Estimated power use (mAh):
  Capacity: 2770, Computed drain: 28440, actual drain: 2410-2465
  Cell standby: 26122 ( radio=26122 ) Excluded from smearing
  Idle: 1808 Excluded from smearing
  Bluetooth: 444 ( cpu=2.30 wake=0.0108 bt=442 ) Including smearing: 5593 ( proportional=5149 )
  Uid 1000: 26.3 ( cpu=26.3 wake=0.00869 sensor=0.00279 ) Excluded from smearing
  Uid 0: 24.6 ( cpu=23.4 wake=1.17 ) Excluded from smearing
  Screen: 5.79 Excluded from smearing
  Uid u0a21: 4.14 ( cpu=3.73 wake=0.000788 sensor=0.412 ) Excluded from smearing
  Uid 1036: 2.50 ( cpu=2.50 ) Excluded from smearing
  Uid 1001: 0.845 ( cpu=0.844 wake=0.000522 ) Excluded from smearing
  Uid u0a70: 0.454 ( cpu=0.454 ) Including smearing: 5.71 ( proportional=5.26 )
  ...
  Over-counted: 25974 ( ) Including smearing: 0 ( ) Excluded from smearing
```

- Capacity: 电池容量, Computed drain: 计算得到的耗电量, actual drain: 实际耗电量。本例中，计算得到的耗电量(28440mAh)竟然是实际耗电量(2410~2465mAh)的10几倍，进一步说明耗电统计只是一个近似计算
- Cell standby：射频待机的耗电量。正是由于这里计算出了26122mAh的耗电量，导致总体计算值出现了很大的偏差。为什么会计算出这么大的值呢？要么是单位电流值配置出错了，要么是使用时间计算出错了
- Bluetooth：蓝牙使用的耗电量。
- Uid XXX：一个Uid的耗电量，可以近似理解为一个应用的耗电量。在高版本的日志中，会再进行细分，括号中cpu=26.3 wake=0.00869 sensor=0.00279，就表明一个应用使用cpu的电量是26.3mAh，持有wake lock的耗电量是0.00869mAh，使用传感器的耗电量是0.00279mAh

这一部分日志是按照耗电量的从大到小排序的，通常我们只需关注头部耗电占比严重的模块。

### 2.5.3 All kernel wake locks

按持锁时间排序，显示不同内核锁的持锁时间和次数。

`batterystats`会从**/proc/wakelocks**和**/d/wakeup_sources**这两个文件中读取内核的持锁情况。有兴趣的读者可以查阅源码[KernelWakelockReader.java]({{ site.android_source }}/platform/frameworks/base/+/master/core/java/com/android/internal/os/KernelWakelockReader.java)。


```
  All kernel wake locks:
  Kernel Wake lock [timerfd]   : 11m 57s 252ms (13238 times) realtime
  Kernel Wake lock NETLINK     : 8m 44s 333ms (32058 times) realtime
  Kernel Wake lock qpnp_fg_sanity_check: 1m 49s 914ms (73 times) realtime
  Kernel Wake lock alarmtimer  : 1m 40s 307ms (50 times) realtime
  ...
```

一旦有内核持锁，那CPU是无法休眠的，一直以较高的频率运行导致的结果就是耗电。
上面日志中，累计持锁时间最长的是**[timerfd]**，累计持锁13238次，累计时长11分57秒。这是一份待机12天的日志，累计最长时间的内核锁仅仅持锁了不到12分钟，说明只是一些正常的唤醒。

对于应用而言，是不能直接使用内核锁的，需要通过Android提供的Wake Lock机制，使用PowerManager接口来申请和释放锁。应用可以持有多个不同的锁，但反应到内核的锁也就三种：

- **PowerManagerService.WakeLocks**：控制CPU状态的锁
- **PowerManagerService.Display**： 控制屏幕状态的锁
- **PowerManagerService.Broadcasts**：控制电源状态改变的通知锁

如果在这部分日志中，发现以上三种锁持有时间很长，那说明很可能是应用使用Wake Lock不当导致的。

### 2.5.4 All partial wake locks

按持锁时间排序，显示不同应用锁的持锁时间和次数。

在一些应用场景下，需要保持CPU处于工作状态，譬如：打游戏、看视频、灭屏听音乐、后台下载等，这时候，就要向框架层的电源管理服务申请Wake Lock，再由框架层决策是否向内核申请锁。

```
  All partial wake locks:
  Wake lock 1001 RILJ_ACK_WL: 24m 4s 809ms (6700 times) max=526 actual=1642274 (running for 0ms) realtime
  Wake lock 1001 RILJ: 2m 53s 606ms (13642 times) max=220 actual=350673 realtime
  Wake lock 1000 deviceidle_maint: 1m 7s 186ms (3 times) max=30307 actual=90799 realtime
  ...
```

上面的日志中，**RILJ_ACK_WL**这个来自uid 1001的锁累计持锁时间最长，为24分4秒，累计被唤醒了6700次。

这里介绍几个比较常见：

- RIJ：通信上层需要向Modem发送数据时，会获取名为RIJ的锁
- RILJ_ACK_WL：通信上层收到Modem上报的数据后，需要向Modem回复一个ACK，此时会获取名为RILJ_ACK_WL的锁
- NetworkStats：进行流量统计时所持有的锁
- \*walarm\*或者\*alarm\*： 通过AlarmManager唤醒所持有的锁
- \*job\*/xxx：通过JobScheduler调度的任务所持有的锁
- \*vibrator\*：在震动状态下所持有的锁
- deviceidle_maint：进入Doze Maintainace状态所持有的锁，此时，手机从深度睡眠中唤醒，用很短的时间执行之前被搁置的CPU任务

如果我们对常见的锁比较了解，就能够评估出CPU时间究竟被什么任务占用了。正常情况下，任何一个锁都不应该长时间不释放，导致严重耗电的往往是那些持锁时间较长的进程。

### 2.5.5 All wakeup reasons

按唤醒次数排序，显示不同的持锁原因。

```
  All wakeup reasons:
  Wakeup reason 168:qcom,smd-rpm-summary:280:681b8.qcom,mpm:174:400f000.qcom,spmi:184:qpnp_rtc_alarm: 13m 22s 325ms (3182 times) realtime
  Wakeup reason Abort:Callback failed on 7570000.uart in msm_hs_pm_sys_suspend_noirq+0x0/0x134 returned -16: 26m 28s 17ms (2683 times) realtime
  Wakeup reason 168:qcom,smd-rpm-summary: 2m 49s 118ms (467 times) realtime
  ...
```

上面的日志中，**168:qcom,smd-rpm-summary:280:681b8.qcom,mpm:174:400f000.qcom,spmi:184:qpnp_rtc_alarm**这个原因导致了3182次唤醒。唤醒原因是Native层上报的，有些日志需要有内核和驱动的开发经验才能看懂。

### 2.5.6 Statistics by uid

`batterystats`是按照uid来统计耗电的，每一个uid的耗电详情都会在这一部分日志中体现出来。在[Process.java]({{ site.android_source }}/platform/frameworks/base/+/master/core/java/android/os/Process.java)定义了不同uid的值：

```java
public static final int ROOT_UID = 0;         // initd、netd、installd等内核进程
public static final int SYSTEM_UID = 1000;    // system、settings、servicemanager等系统进程
public static final int PHONE_UID = 1001;     // phone、rild等通信进程
public static final int BLUETOOTH_UID = 1002; // 蓝牙进程
public static final int FIRST_APPLICATION_UID = 10000;  // 应用进程的初始UID值
public static final int LAST_APPLICATION_UID = 19999;   // 应用进程的最大UID值
```

Android中预设的uid都是小于10000的，应用进程的uid是在[10000,19999]这个区间分配的，为了描述方便，10000就用字符*a*代替了，例如：u0a21就表示uid为10021，前面的*u0*表示这是user 0(默认的Android用户编号就是0)。

> **注意**：Android用户的编号不同于uid，Android是一个多用户系统，会为每一个用户分配一个用户编号，通常我们的手机就我们自己用，对多用户的感受不明显，但如果映射到Window上的用户，就好理解了，管理员和普通用户就是两个不同的用户，不同的用户可以独立管理自己的桌面和文件，互不影响。
>
> uid是linux用户的概念，Android为了做进程隔离，借用linux的uid来隔离不同进程的数据，这就是所谓的“沙箱机制”。Android为每一个包都分配了一个uid，简单理解，我们安装一个APK时，就会为这个APK分配一个uid，一旦分配完成，这个uid就不会改变了。运行这个APK时，这个uid就会映射到一个或多个进程。当然，Android还提供另外一种机制，通过sharedUserId和签名可以将不同APK运行在同一个进程中，但此时，不同APK的uid是一样的，都是sharedUserId配置的值。

理解了uid的概念后，先来看uid为0的耗电详情：

```
  CPU freqs: 307200 384000 460800 537600 614400 691200 748800 768000 825600 844800 902400 979200 1056000 1132800 1209600 1286400 1363200 1440000 1516800 1593600 1670400 1747200 1824000 1900800 1977600 2054400 2150400

  0:
    Total cpu time: u=31s 337ms s=14m 36s 531ms 
    Total cpu time per freq: 402470 17540 18100 18030 15310 5760 1230 1740 1650 1320 2230 1650 1170 1140 300 440 390 790 340 1180 150 90 80 60 90 80 770
    Total screen-off cpu time per freq: 399680 17280 17890 17870 15110 5570 1200 1540 1550 1170 2010 1530 1090 690 270 430 330 590 260 740 110 60 60 40 80 80 510
    Proc irq/19-408000.q:
      CPU: 0ms usr + 3s 410ms krn ; 0ms fg
    Proc android.hardware.wifi@1.0-service:
      CPU: 10ms usr + 20ms krn ; 0ms fg
    ...
```

- CPU freqs：CPU所有的频率值，最小的307200(300M Hz)，最大的2150400(2.05G Hz)
- Total cpu time：累计的CPU使用时间
- Total cpu time per freq：在不同CPU频率下的使用时间
- Total screen-off cpu time per freq：灭屏状态下，不同CPU频率的使用时间
- Proc：每一个进程的CPU使用时间

再来看另外一个uid为1000的耗电详情，系统相关的进程都被统计到这个uid下：

```
  1000:
    User activity: 4 other, 6 button, 27 touch
    Wake lock ActivityManager-Sleep: 48ms partial (1 times) max=53 actual=53 realtime
    Wake lock *alarm*: 16s 109ms partial (349 times) max=213 actual=23936 realtime
    Wake lock PhoneWindowManager.mPowerKeyWakeLock: 17ms partial (1 times) max=17 realtime
    ...
    Audio: 1s 480ms realtime (7 times)
    Sensor 7: 1m 39s 460ms realtime (2 times)
    Sensor 30: 1m 39s 392ms realtime (3 times)
    Vibrator: 100ms realtime (5 times)
    Foreground activities: 18s 747ms realtime (6 times)
    Fg Service for: 12d 21h 29m 48s 696ms 
    Total running: 12d 21h 29m 48s 696ms 
    Total cpu time: u=2m 25s 691ms s=14m 19s 515ms 
    Total cpu time per freq: 889380 52900 50670 42700 45550 19950 1170 10610 1350 8400 6780 6260 4810 3680 1180 1800 1460 2230 1340 5320 350 220 160 110 90 140 11910
    Total screen-off cpu time per freq: 885260 52060 49940 41850 44600 18870 1030 9190 1170 7040 5480 4990 4320 2270 1030 1660 1270 1570 770 2420 160 50 90 40 70 80 660
    Proc android.hardware.memtrack@1.0-service:
      CPU: 160ms usr + 210ms krn ; 0ms fg
    Proc imsqmidaemon:
      CPU: 80ms usr + 1s 560ms krn ; 0ms fg
    Proc servicemanager:
      CPU: 400ms usr + 960ms krn ; 0ms fg
    ...
    Apk android:
      Wakeup alarm *walarm*:*job.delay*: 33 times
      Wakeup alarm *walarm*:ScheduleConditionProvider.EVALUATE: 51 times
      Wakeup alarm *walarm*:*job.deadline*: 9 times
      Wakeup alarm *walarm*:com.android.server.ACTION_TRIGGER_IDLE: 2 times
      Wakeup alarm *walarm*:EventConditionProvider.EVALUATE: 12 times
      Service com.android.server.backup.KeyValueBackupJob:
        Created for: 0ms uptime
        Starts: 0, launches: 9
      Service com.android.server.camera.CameraStatsJobService:
        Created for: 0ms uptime
        Starts: 0, launches: 12
      Service com.android.server.PruneInstantAppsJobService:
        Created for: 0ms uptime
        Starts: 0, launches: 13
```

- User activity: 用户的触屏、实体键操作
- Wake lock： 当前uid持有锁的时间和次数统计
- Sensor：传感器使用时间和次数
- Foreground activities：前台界面的显示时间
- Apk android： uid关联到的包名，对于系统进程而言，包名就是android，这个包名来自于framework-res.apk

**至此，整个电量统计的日志就分析完毕了。**