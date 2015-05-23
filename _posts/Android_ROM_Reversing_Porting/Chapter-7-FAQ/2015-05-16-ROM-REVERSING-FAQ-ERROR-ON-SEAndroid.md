---
layout: post
title: ROM逆向适配——常见错误3
category: ROM逆向适配
tagline: SELinux/SEAndroid权限相关
tags: [SELinux权限限制]
---
{% include JB/setup %}

分析由于SEAndroid的限制导致的错误

## SEAndroid访问权限限制

**错误提示**

    D/DefContainer( 5049): Copying /storage/emulated/0/Download/AppCenter/Apk/com.tencent.mm_543.apk to base.apk
    W/PackageManager(  901): type=1400 audit(0.0:1192): avc: denied { write } for path="/data/app/vmdl1237036830.tmp/base.apk" dev="mmcblk0p28" ino=162887 scontext=u:r:untrusted_app:s0 tcontext=u:object_r:apk_tmp_file:s0 tclass=file
    E/JavaBinder( 5049): !!! FAILED BINDER TRANSACTION !!!
    W/DefContainer( 5049): Failed to copy package at /storage/emulated/0/Download/AppCenter/Apk/com.tencent.mm_543.apk: android.os.TransactionTooLargeException
    E/PackageManager(  809): Failed to copy package
    
**出错原因**

TODO

**解决方案**

TODO

***

**错误提示**

    E/SELinux (  200): avc:  denied  { add } for service=PowerService scontext=u:r:init:s0 tcontext=u:object_r:default_android_service:s0 tclass=service_manager

    