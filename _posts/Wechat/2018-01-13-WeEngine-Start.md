---
layout: post
category : 小白文
title: 微擎环境搭建指南
tagline:
tags: 微擎开发
---

本文基于`MacOS`，介绍如何定制微擎运行环境。
阅读本文之前，读者需要了解：在MacOS下通过brew安装软件包。

# 1. 环境搭建

## 1.1 下载微擎源码

可以选择下载**[微擎官方源码](http://s.we7.cc/store-static-install.html)**离线版，本文下载的微擎是`1.0稳定版`。

同时，笔者将源码保存在到了github上，可以通过以下命令直接下载：

```
git clone https://github.com/etutorial/WeEngine.git
```

## 1.2 安装nginx

```
$ brew install nginx
```

在浏览器中输入`localhost:8080`，如果看到如下界面内容，表示`nginx`安装成功：

<div align="center"><img src="/assets/images/junior/weengine/1-weengine-nginx-installed.png" /></div>

配置文件`/usr/local/etc/nginx/nginx.conf`

## 1.3 安装mysql

```
$ brew install mysql
```

启动mysql，设置初始化密码：

```
mysql.server start
mysql_secure_installation
```

然后，根据命令提示输入密码即可。

## 1.4 安装微擎

微擎依赖于php，MacOS默认自带了php，因此直接执行如下命令即可，其中**/Users/duanqz/Code/WeEngine**是微擎的源码目录：

```
$ php -S 127.0.0.1:8080 -t /Users/duanqz/Code/WeEngine
```

在浏览器中输入`127.0.0.1:8080`，出现以下界面表示php环境运行正常：

<div align="center"><img src="/assets/images/junior/weengine/2-weengine-php-installed.png" /></div>

点击`install.php 进入安装`，按照操作提示下一步即可。其中参数配置一步，需要配置数据库连接信息和微擎后台管理员账号：

<div align="center"><img src="/assets/images/junior/weengine/3-weegine-installing-config.png" /></div>

在测试环境下:

- 数据库主机输入的是本机(`127.0.0.1`)的mysql
- 数据库账号和密码是之前配置的root和12345678
- 表前缀和数据库名称选择了默认值ims_和we7
- 微擎的后台管理员账户/密码配置为admin/admin

成功安装微擎后，便会进入微擎后台的登录界面，输入刚才配置的管理员用户，便进入到微擎的主界面：

<div align="center"><img src="/assets/images/junior/weengine/4-weengine-installed.png" /></div>

## 1.5 常见问题

### 1.5.1 mysql没有启动

mysql没有启动，则会报如下错误，按照上述步骤启动mysql即可。

```
发生错误: SQLSTATE[HY000] [2002] Connection refused
```

### 1.5.2 msql中存在重名的数据库

mysql中已经存在相同的数据库或表前缀。在重复安装微擎的运行环境时会出现如下错误。
删除mysql中的重名数据库和数据表即可。可以使用MySQLWorkbench、Navicat、TeamSQL等图形化的客户端。

```
发生错误: 您的数据库不为空，请重新建立数据库或是清空该数据库或更改表前缀！
```

### 1.5.3 重新安装微擎

如果需要修改数据库和数据表名，则需要重新安装微擎，删除微擎源码目录下的以下子目录即可：

```
data/config.php    # 微擎运行的配置信息，之前输入的数据库连接信息就保存在此文件中
data/install.lock  # 一个锁标识，标识微擎已经正确安装
data/tpl/          # 根据源码生成的最终用户界面
```

使用如下命令，连接数据库，可展示出数据库中微擎默认创建的数据表，删除这些表即可。

```
$ mysql --user=root --password we7
Enter password:  # 输入密码12345678
mysql> show tables;
+-------------------------------+
| Tables_in_we7                 |
+-------------------------------+
| ims_account                   |
| ims_account_wechats           |
| ims_account_wxapp             |
| ims_article_category          |
| ims_article_news              |
  ...  # 此处省略了很多其他表
| ims_wxapp_versions            |
| ims_wxcard_reply              |
+-------------------------------+
98 rows in set (0.01 sec)
```

# 2. 微擎定制

TODO