---
layout post
category  dumpsys
tagline meminfo
tags  []
---
{% include JB/setup %}

# 查看内存信息的方式

在Linux上要，查看内存信息，

Linux在内核2.6.25以上的版本，为用户空间提供一组名为pagemap的接口，用户进程可以通过读取/proc中的文件来进行页表检查

## procrank

部分Andorid手机没有安装procrank命令，需要自行安装。

{% highlight console %}
$ adb shell procrank
  PID       Vss      Rss      Pss      Uss  cmdline
  752  1759396K  161936K   97986K   89876K  system_server
  907  1652064K  146672K   83775K   74088K  com.android.systemui
 1283  1665524K  125984K   63174K   52124K  com.android.launcher3
 9578  1654704K  106592K   47788K   42016K  com.android.browser
 1072  1583960K   80844K   24473K   21420K  com.android.settings
 3230  1588056K   74112K   20503K   18344K  com.android.email
 1978  1587312K   70820K   18512K   15540K  com.android.incallui
 2244  1588408K   71408K   18401K   16380K  com.android.mms
 1250  1558848K   65668K   18326K   16612K  com.android.phone
 4786  1563376K   63084K   14438K   12368K  com.android.systemui:screenshot
  196  1503616K   67332K   12779K    8032K  zygote
  918  1535740K   56152K   10591K    9172K  android.process.media
  186   129640K   13096K   10016K    9268K  /system/bin/mediaserver
 1220  1529296K   52700K    7346K    6104K  com.android.nfc
 3138  1543048K   52020K    7338K    4940K  com.android.dialer
 2485  1538988K   51956K    6872K    4988K  com.android.calendar:birthday
 2162  1530764K   51012K    6809K    5688K  com.android.providers.calendar
  170   108072K   11856K    6208K    5336K  /system/bin/surfaceflinger
 1538  1524320K   48508K    5338K    4264K  com.android.providers.usagestats
 2113  1520476K   46516K    4745K    3732K  com.meizu.mpay
 1950  1519196K   44588K    4323K    3316K  com.android.smspush
  184    32876K    5596K    3783K    3544K  /system/bin/rild
  165    15556K    3460K    2799K    2776K  /system/bin/logd
  198    11176K    3040K    2408K    2384K  /system/bin/mm-qcamera-daemon
10826     6140K    1916K    1585K    1580K  procrank
 1049     7436K    2808K    1494K    1344K  /system/bin/wpa_supplicant
  181    21800K    1684K    1010K     964K  /system/bin/netd
  197     8252K    1484K     895K     868K  /system/bin/sdcard
  169     9756K    1960K     892K     820K  /system/bin/vold
  190    20988K    1200K     752K     732K  /system/bin/qmuxd
  188     6316K    1740K     667K     604K  /system/bin/keystore
  191    10820K    1200K     660K     596K  /system/bin/netmgrd
    1     2612K     792K     642K     532K  /init
  127     2608K     600K     486K     376K  /sbin/ueventd
24608    10804K     500K     472K     472K  /sbin/adbd
  167     4460K    1208K     417K     320K  /system/bin/lmkd
  178     3196K     744K     417K     412K  /system/bin/sh
  166     3684K     324K     320K     320K  /sbin/healthd
  183     3828K     864K     299K     284K  /system/bin/debuggerd
  168     3236K     672K     288K     280K  /system/bin/servicemanager
24659     3060K     636K     276K     268K  logcat
  187     3192K     680K     276K     268K  /system/bin/installd
                           ------   ------  ------
                          924832K  802352K  TOTAL
{% endhightlight %}

- VSS
- RSS
- PSS
- USS

## dumpsys

{% highlight console %}
$ adb shell dumpsys meminfo
Applications Memory Usage (kB):
Uptime: 899197 Realtime: 1401967

Total PSS by process:
    76739 kB: com.android.systemui (pid 1037)
    70310 kB: com.android.launcher3 (pid 2800 / activities)
    68876 kB: system (pid 792)
    53001 kB: com.android.settings (pid 1360 / activities)
    ...
      189 kB: dumpsys (pid 3178)
      182 kB: installd (pid 243)
      164 kB: healthd (pid 226)
      150 kB: wifi2agps (pid 255)
      139 kB: thermal (pid 267)

Total PSS by OOM adjustment:
    59705 kB: Native
               21648 kB: mediaserver (pid 242)
               10510 kB: zygote (pid 240)
                5250 kB: surfaceflinger (pid 239)
                 110 kB: batterywarning (pid 274)
                 ...
                 106 kB: thermald (pid 270)
    68876 kB: System
               68876 kB: system (pid 792)
   127448 kB: Persistent
               76739 kB: com.android.systemui (pid 1037)
               20698 kB: com.android.phone (pid 1258)
               ...
    53001 kB: Foreground
               53001 kB: com.android.settings (pid 1360 / activities)
    45730 kB: Visible
               11123 kB: com.android.incallui (pid 1621)
    25498 kB: Perceptible
               25498 kB: com.baidu.input_mz (pid 1199)
    27550 kB: A Services
                7923 kB: android.process.media (pid 2703)
                4711 kB: com.android.calendar:birthday (pid 2127)
    70310 kB: Home
               70310 kB: com.android.launcher3 (pid 2800 / activities)
    60033 kB: B Services
                7694 kB: com.android.mms (pid 1891)
    59686 kB: Cached
               19075 kB: android.process.acore (pid 2951)
                6250 kB: com.android.calendar (pid 3120)
                5528 kB: com.android.dialer (pid 3012)
                3857 kB: com.android.providers.calendar (pid 3145)
                3702 kB: com.android.providers.usagestats (pid 2627)

Total PSS by category:
   280038 kB: Dalvik
    73256 kB: Unknown
    68836 kB: .so mmap
    60290 kB: Dalvik Other
    56729 kB: .dex mmap
    34571 kB: .apk mmap
     9291 kB: Other mmap
     5940 kB: Stack
     5532 kB: Native
     2760 kB: .ttf mmap
      290 kB: Other dev
      204 kB: .jar mmap
       84 kB: Ashmem
       16 kB: Cursor
        0 kB: code mmap
        0 kB: image mmap
        0 kB: Graphics
        0 kB: GL
        0 kB: Memtrack

Total RAM: 1945628 kB
 Free RAM: 1182598 kB (59686 cached pss + 326668 cached + 796244 free)
 Used RAM: 570943 kB (538151 used pss + 3440 buffers + 464 shmem + 28888 slab)
 Lost RAM: 192087 kB
     ZRAM: 4 kB physical used for 0 kB in swap (524284 kB total swap)
   Tuning: 192 (large 512), oom 122880 kB, restore limit 40960 kB (high-end-gfx)
{% endhighlight %}

## OOM adjustment

    // Adjustment used in certain places where we don't know it yet.
    // (Generally this is something that is going to be cached, but we
    // don't know the exact value in the cached range to assign yet.)
    UNKNOWN_ADJ = 16;

    // This is a process only hosting activities that are not visible,
    // so it can be killed without any disruption.
    CACHED_APP_MAX_ADJ = 15;
    CACHED_APP_MIN_ADJ = 9;

    // The B list of SERVICE_ADJ -- these are the old and decrepit
    // services that aren't as shiny and interesting as the ones in the A list.
    SERVICE_B_ADJ = 8;

    // This is the process of the previous application that the user was in.
    // This process is kept above other things, because it is very common to
    // switch back to the previous app.  This is important both for recent
    // task switch (toggling between the two top recent apps) as well as normal
    // UI flow such as clicking on a URI in the e-mail app to view in the browser,
    // and then pressing back to return to e-mail.
    PREVIOUS_APP_ADJ = 7;

    // This is a process holding the home application -- we want to try
    // avoiding killing it, even if it would normally be in the background,
    // because the user interacts with it so much.
    HOME_APP_ADJ = 6;
    
    // This is a process holding an application service -- killing it will not
    // have much of an impact as far as the user is concerned.
    SERVICE_ADJ = 5;

    // This is a process with a heavy-weight application.  It is in the
    // background, but we want to try to avoid killing it.  Value set in
    // system/rootdir/init.rc on startup.
    HEAVY_WEIGHT_APP_ADJ = 4;

    // This is a process currently hosting a backup operation.  Killing it
    // is not entirely fatal but is generally a bad idea.
    BACKUP_APP_ADJ = 3;

    // This is a process only hosting components that are perceptible to the
    // user, and we really want to avoid killing them, but they are not
    // immediately visible. An example is background music playback.
    PERCEPTIBLE_APP_ADJ = 2

    // This is a process only hosting activities that are visible to the
    // user, so we'd prefer they don't disappear.
    VISIBLE_APP_ADJ = 1;

    // This is the process running the current foreground app.  We'd really
    // rather not kill it!
    FOREGROUND_APP_ADJ = 0;

    // This is a process that the system or a persistent process has bound to,
    // and indicated it is important.
    PERSISTENT_SERVICE_ADJ = -11;

    // This is a system persistent process, such as telephony.  Definitely
    // don't want to kill it, but doing so is not completely fatal.
    PERSISTENT_PROC_ADJ = -12;

    // The system process runs at the default adjustment.
    SYSTEM_ADJ = -16;

    // Special code for native processes that are not being managed by the system
    // (so don't have an oom adj assigned by the system).
    NATIVE_ADJ = -17;


## /proc/meminfo

{% highlight console %}
$ adb shell cat /proc/meminfo
MemTotal:        1945628 kB
MemFree:          805664 kB
Buffers:            3432 kB
Cached:           326668 kB
SwapCached:            0 kB
Active:           449572 kB
Inactive:         347344 kB
Active(anon):     375844 kB
Inactive(anon):    91436 kB
Active(file):      73728 kB
Inactive(file):   255908 kB
Unevictable:           0 kB
Mlocked:               0 kB
HighTotal:       1456128 kB
HighFree:         703936 kB
LowTotal:         489500 kB
LowFree:          101728 kB
SwapTotal:        524284 kB
SwapFree:         524284 kB
Dirty:                 0 kB
Writeback:             0 kB
AnonPages:        466856 kB
Mapped:           127556 kB
Shmem:               464 kB
Slab:              28916 kB
SReclaimable:      10452 kB
SUnreclaim:        18464 kB
KernelStack:        8224 kB
PageTables:        15012 kB
NFS_Unstable:          0 kB
Bounce:                0 kB
WritebackTmp:          0 kB
CommitLimit:     1497096 kB
Committed_AS:   31114736 kB
VmallocTotal:     499712 kB
VmallocUsed:      155212 kB
VmallocChunk:     131008 kB
{% endhighlight %}

