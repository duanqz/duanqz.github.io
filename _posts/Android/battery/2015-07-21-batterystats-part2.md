---
layout: post
category: Android启智观
title: 电量统计(2)-日志
tagline: batterystats
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
  - **Estimated power use (mAh)**: 很重要的信息，近似计算出的各个用户(uid)的耗电量，一个APK通常对应到一个用户，当然，也有多个APK共享一个用户的情况
  - **All kernel wake locks**: Kernel Wakelock的使用情况
  - **All partial wake locks**: 应用层Wakelock的使用情况
  - **All wakeup reasons**: 所有的唤醒原因
  - **uid**: 每一个uid下的进程以及使用硬件设备的情况

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

按持锁时间排序，显示不同kernel wake lock的持锁时间和次数。

```
  All kernel wake locks:
  Kernel Wake lock [timerfd]   : 11m 57s 252ms (13238 times) realtime
  Kernel Wake lock NETLINK     : 8m 44s 333ms (32058 times) realtime
  Kernel Wake lock qpnp_fg_sanity_check: 1m 49s 914ms (73 times) realtime
  Kernel Wake lock alarmtimer  : 1m 40s 307ms (50 times) realtime
  ...
```

`batterystats`会从**/proc/wakelocks**和**/d/wakeup_sources**这两个文件中读取Kernel wake lock的持锁情况。
有兴趣的读者可以查阅源码[KernelWakelockReader.java]({{ site.android_source }}/platform/frameworks/base/+/master/core/java/com/android/internal/os/KernelWakelockReader.java)

### 2.5.4 All partial wake locks

### 2.5.5 All wakeup reasons
