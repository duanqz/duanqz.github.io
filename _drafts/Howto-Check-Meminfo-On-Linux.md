---
layout post
category Linux
tagline meminfo
tags  []
---
{% include JB/setup %}

# 查看内存信息的方式

Linux在内核2.6.25以上的版本，为用户空间提供一组名为pagemap的接口，用户进程可以通过读取/proc中的文件来进行页表检查。

## 1. free

{% highlight console %}
duanqizhi@xo:~/Desktop$ free -h
             total       used       free     shared    buffers     cached
Mem:           15G        13G       1.7G       674M       627M       6.8G
-/+ buffers/cache:       6.4G       9.2G
Swap:          17G       139M        17G
{% endhight %}



## 2. /proc/meminfo


## 3. vmstat

## 4. top
