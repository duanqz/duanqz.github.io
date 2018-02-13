---
layout: post
category: Android启智观
title: Android数字签名机制和应用场景
tagline:
tags:  [Android数字签名]
---

本文以Android 7.1的代码为蓝本，部分源码在不同Android版本上略有区别。

# 1 数字签名介绍

本节的内容概要如下：

- 首先，介绍数字签名的产生背景，有什么用途以及怎么用，涉及到经常被拿出来比对的概念：**数字签名(Digital Signature)**和**电子签名(Electronic Signature)**。

- 然后，介绍数字签名的运行机制，数据加密和认证的过程，涉及到的重要概念：**密钥对(Key Pair)，即私钥(Private Key)和公钥(Public Key)**。

- 最后，通过介绍两个与数字签名相关的工具**ssh-keygen**和**keytool**，一个密钥管理文件**keystore**，引申出几个重要的概念：**证书(Certificate)**、**证书链(Certificate Chain)**、**证书认证机构(Certificate Authority)**。

## 1.1 背景

Digital Signature直译成中文就是数字签名，是Whitfield Diffie和Martin Hellman早在1976年就提出的概念，以他们名字命名的Diffie-Hellman Key Exchange算法可以用于在公开网络上传送密钥。
随后，由Ron **R**ivest, Adi **S**hamir和Leonard **A**dleman三人发明的RSA算法，被广泛运用到数字签名中。首个投放到市场的数字签名应用在1989年发布，采用的算法就是RSA。

**签名有什么用呢？**

生活中，大家一定有签名表身份的经历，譬如：在刷银行卡消费时，需要签上自己的大名，收银员有时还会对比一下你签的名与银行卡上签名栏是否匹配；在签署合同时，往往需要潇洒的挥上自己的大名，甚至手抹红印，按下指纹。这些都是为了确定行为人的身份，作为后续问题追溯的依据。数字签名的**签名**两字正是源于生活，意在确定身份，而**数字**两字表明其是签名的一种类型：基于密码学的签名方式。被数字签名广泛采用的RSA算法就是一种加密算法。

**数字签名怎么用呢？**

在网络发送信息时，存在安全问题，因为在发送者和接收者之间可能存在第三者，截获发送者信息，进行篡改后，再发送给接收者。为了解决这类安全问题，发送者可以对数据进行数字签名，当接收者拿到一堆签名后的数据时，可以对数据进行校验，一旦校验成功，接收者可以信心满满的说：

- 这些数据一定是某人发送过来的，可以通过其他机构确定发送人的资质。
- 发送者不可抵赖这是自己发送的，一旦接收者一口咬定数据是来源于某位发送者，那发送者只能心服首肯。
- 这些数据一定没有被篡改，否则不会通过校验。

这其实就是数字签名的三大特性：**可认证性(authentication)、不可抵赖性(non-repudiation)和完整性(integrity)**。即便收到被第三者篡改的数据，接收者也可以确定数据不是来源于受信的发送者，而且数据肯定被动过。

> 自古以来，手写签名、按压指纹这种传统的签名方式都是具有法律效应的。在电子信息如此发达的今天，**电子签名(Electronic Signature)**也是被很多国家和地区(欧盟、美国)也被立法保护。读者在接触数字签名的概念时，往往会关联到电子签名的概念，前者属于技术实现的范畴，后者属于人文律法的范畴。
>
> 人们认可电子签名在法律上的有效性，而数字签名采用一定的加密算法，来保障电子签名的这种有效性。诚然，加密算法总有过时的一天，譬如广泛应用的低位数的RSA算法就已经被破解了，这时候，电子签名的有效性就消失了，需要进一步更新数字签名的算法，继续维持电子签名的法律有效性。
>
> 这里，还需要说明一点，并非所有的电子签名实现都是采用数字签名。

## 1.2 机制

**数字签名是如何保证可认证、不可抵赖和完整性的呢？**这得从数字签名的算法说起。数字签名的实现包含三个算法：

1. **密钥生成算法**。数字签名采用的是非对称密钥生成算法，即会生成一对密钥：私钥和公钥。用私钥加密的数据，只能用对应的公钥解密。私钥是应该要保护起来，不会泄露给其他人；公钥是完全公开的，会随着加密数据一起在公开网络上传送。

2. **签名算法**。给定私钥(private key)和数据(message)，可以生成一个签名(signature)。

3. **签名验证算法**。给定数据(message)、公钥(public key)和签名(signature)，可以解密数据并验证数据的来源和完整性。

> 密钥有对称(symmetric)和非对称(public)之分。对称密钥只有一个，同时用于加密和解密，就像我们用同一把钥匙开门和锁门，谁拿到钥匙，谁就掌握了房间的使用权。DES和AES这种加密算法采用的是对称密钥，而上文提到的RSA算法采用的是非对称密钥。

下图示意了数字签名的运行机制：

<div align="center"><img src="/assets/images/digitalsignature/1-digital-signature-mechanisum.png" alt="数字签名机制"/></div>

- 对待发送的数据明文进行Hash，通常可采用MD5或SHA算法，然后采用私钥对Hash值进行加密，得到签名。将数据明文和签名一同发送出去。为什么要先对原始数据进行Hash后再用私钥加密呢？因为原数据可能比较大，直接使用私钥加密将会非常耗时。

- 接收数据以后，会经过签名验证，其实就是比较两个Hash值：采用同样的Hash算法对数据明文进行解密，得到一个Hash值；采用公钥对签名进行解密后，得到原始的Hash值。如果两个Hash值相同，则说明数据没有被篡改而且来源可信：

    - 如果用公钥解密成功，则说明公钥与签名的私钥是唯一配对的，即一定是某个私钥的签名，这就保障了来源不可抵赖。

    - 如果数据被篡改，则接收到数据的Hash值与解密后的Hash值不会相同，这就保障了完整性。

    - 接收到的公钥是可以由第三方权威机构(Certificate Authority)认证的，因此接收方可以验证来源是否可靠，这就可以保障来源的可认证性。关于CA认证我们后文再展开。

说了这么多，其实**数字签名最神奇的地方就在于密钥对：用私钥加密后的数据只能用对应的公钥解密。** RSA算法的理论根基是欧拉定理，可以参见[RSA算法原理介绍](http://www.ruanyifeng.com/blog/2013/06/rsa_algorithm_part_one.html)。

## 1.3 使用

了解数字签名的基本概念之后，就需要进一步了解一些数字签名的使用工具和衍生概念。

### 1.3.1 ssh-keygen

在使用SSH(Secure SHell)进行远程登录或其他网络请求时(譬如下载git库)，会接触到**ssh-keygen**。相比Telent, FTP这些协议，SSH是安全的，因为可以使用ssh-keygen生成一对密钥，对通信过程进行加密，防止第三方攻击。

举一个最常见的例子，github上的开源项目均支持通过SSH协议进行下载，这就需要在github上添加一个**SSH Key**，否则无法正常下载github上的项目。

首先，会先在本地使用**ssh-keygen**命令生成一个密钥对：

```console
$ ssh-keygen
Generating public/private rsa key pair.
Enter file in which to save the key (~/.ssh/id_rsa):
Enter passphrase (empty for no passphrase):
Enter same passphrase again:
Your identification has been saved in ~/.ssh/id_rsa.
Your public key has been saved in ~/.ssh/id_rsa.pub.
The key fingerprint is:
ac:70:ea:54:20:75:ce:8e:ec:ed:36:8f:b2:4a:3d:26 xo@X
The key's randomart image is:
+--[ RSA 2048]----+
|    . .          |
|   . +           |
|  . . o          |
|   o + .         |
|    + + S        |
|   o * .         |
|  E B o          |
| . =.oo.         |
|  ..o+oo.        |
+-----------------+
```

该命令执行完后，会在用户目录下的**.ssh**子目录生成两个文件：`id_rsa`和`id_rsa.pub`。

然后，便是将id_rsa.pub的文件内容粘贴到github的**SSH Key**中。完成配置后便可通过SSH下载远程代码，知其然却不知其所以然。在理解了数字签名的基本概念后，再来看这个过程：

- **ssh-keygen**默认采用RSA算法生成了私钥(id_rsa)和公钥(id_rsa.pub)。上文中采用的是RSA 2048位的算法，因为256,512位的RSA算法已经被破解了。这里需要提出的是，除了RSA，还有其他密钥对的生成算法，譬如DSA(Digital Signature Algorithm)、EdDSA(Edwards-curve Digital Signature Algorithm)等，可以通过**ssh-keygen**的*-t*参数指定密钥对的生成算法。

  > 使用**ssh-keygen**生成密钥对时，会提示输入一个口令(passphrase)，用来保护私钥。口令采用的对称密钥加密算法，简单来说，口令就像银行卡密码一样，需要记在脑子里。
  >
  > 公钥通常比较长，上文中RSA算法生成的公钥是2048位，为了便于描述和比对，采用MD5算法将公钥映射成128位的Hash值，通常用16进制表示，这一串Hash值就叫做**指纹(Fingerprint)**。

- 将公钥粘贴到github的SSH Key配置项中，能够免去不断输入用户名和密码的烦恼；同时，这说明公钥是完全公开的，但私钥(id_rsa)仍然是保存在本地的。当github收到从客户端发起请求时，会利用客户端的公钥对一串随机数进行加密操作，然后将密文发送给客户端；客户端在收到密文后，会用配对的私钥进行解密，如果解密成功，便可建立一个受信的连接，不用再通过用户名和密码鉴权。

除了github，还有很多代码管理工具都支持SSH，譬如gitlab，oschina，gerrit等，其操作过程都是一致的。因为SSH利用数字签名，建立了安全的连接。

### 1.3.2 keytool

**keytool**是JDK的一个工具，用于密钥和证书的管理。**keytool**的主要操作对象是**keystore文件**，该文件一般以*.keystore或*.jks(Java KeyStore)为后缀名，用于密钥和证书的存储，其存储结构如下图所示：

<div align="center"><img src="/assets/images/digitalsignature/2-digital-signature-keystore.png" alt="keystore的存储结构"/></div>

**keystore**可以存储多个密钥对(Key Pair)，每一个密钥对包含私钥(Private Key)和多个证书(Certificate)。想必诸位读者一定心生怪异了，上文说的密钥对都是一个私钥和一个公钥配对，然而**keystore**中存储的却是私钥和多个证书的配对，到底密钥对是怎么一样对应关系呢？这里有必要把证书和公钥的关系说明清楚了。

**证书(Certificate)**

如其名，用来证明真伪，就像一家企业的营业执照、大学生的毕业证一样，可用来证明其**标的物**的合法性，数字签名中的证书就是用于证明**公钥**的合法性。前文中提过，数字签名算法具备可认证性，然而公钥是完全公开的，很容易被伪造，这样一来，给定一个公钥是无法认证其合法性的，因此，需要给公钥“颁发”一个**证书**，其实现手段就是给公钥再签名一次，得到的结果就是**证书**。上图中，展示了一个完整的证书所包含的属性：Version、Subject、Issuer、Valid From、Valid Until、Public Key(待签名的公钥)、 Signature Algorithm(对公钥签名采用的数字签名算法)、Fingerprint(对公钥签名的公钥)。

**至此，我们知道证书和公钥的关系了：证书就是对公钥再次签名产生的结果，证书包含被签名的公钥、公钥拥有者的信息以及对公钥进行签名的公钥。**
接下来，还有两个重要的概念：**证书认证机构CA(Certificate Authority)**和**证书链(Certificate Chain)**。这两个概念在数字签名体系中经常出现，但并不容易理解。

**证书认证机构CA(Certificate Authority)**和**证书链(Certificate Chain)**

上述证书的生成过程会导致一个无限的链条：要得到证书，就需要给公钥进行数字签名，这就有两个公钥了：证书本身的公钥(即证书中的Public Key，用公钥A表示)和数字签名算法的公钥(即证书中的Fingerprint，用公钥B表示)，要保证公钥B的合法性，我们可以对公钥B再进行数字签名，就又会引入一个新的公钥C，由此类推，还会有公钥D、E、F...，公钥合法性的保证就像链条一样：层层相扣，无穷无尽。怎么办呢？要打破这个无限的链条，就需要有一个权威机构，来统一颁发证书，这个机构就是**CA(Certificate Authority)**，只要是**CA**颁发的证书，就不需要再签名了，就是权威的。然而，全世界需要的证书太多了，光靠一个**CA**是忙不过来的，**CA**得授权一些代理，这些代理也可以颁发证书，代理颁发的证书也被认为是合法可信的，这就形成了一个证书认证的链条，即**证书链**。我们再回过来头来看一下**keystore**文件的结构：一个私钥(Private Key)与多个证书(Certificates)组成密钥对(Key Pair)，其实多个证书的结构就是**证书链**。

> 要理解**CA**和**证书链**，还是可以举毕业证的例子，我们的政府就可以看做一个**CA**，政府授权给教育部，教育部具备颁发和认证毕业证的职能；教育部再授权给各个高校，高校具备颁发自己学校毕业证的职能，教育部和高校就是不同级别的代理，授权过程就像**链条**一样。当我们要认证一个毕业证的真伪时，先拿到所属高校认证一下，如果高校无法确定合法，就拿到教育部认证一下，这种对毕业证的颁发和逐级认证的过程，就可以理解为**证书链**。

**有了这么多概念储备后，就可以轻松理解keytool这个工具的使用了。如果将keystore看做密钥和证书管理的数据库，那么keytool就是这个数据库增、删、改、查的接口。** 笔者在网上搜索keytool的使用，基本都是罗列keytool命令的各中参数，真心记不住啊！好在Eclipse/Android Studio这些IDE都集成了keysotre的图形化工具，为开发人员带来了在签名的便利。

当然，除了Eclipse/Android Studio里面的keystore操作工具，还有很多其他好用的工具，笔者通过[KeyStore Explorer](http://keystore-explorer.org/)工具打开Android的debug.keystore文件(位于~/.android/，存储了Android应用的默认签名)，可以看到如下信息：

<div align="center"><img src="/assets/images/digitalsignature/3-digital-signature-keystore-content.png" alt="keystore的存储内容"/></div>

通过**keytool**命令可以显示出相同的内容：

```console
duanqizhi@xo:~$ keytool -list -v -keystore ~/.android/debug.keystore
Enter keystore password: # 此处需要输入keystore的口令: android
 
Keystore type: JKS
Keystore provider: SUN
 
Your keystore contains 1 entry
 
Alias name: androiddebugkey
Creation date: Jul 1, 2015
Entry type: PrivateKeyEntry
Certificate chain length: 1
Certificate[1]:
Owner: CN=Android Debug, O=Android, C=US
Issuer: CN=Android Debug, O=Android, C=US
Serial number: 588a6601
Valid from: Wed Aug 18 08:03:38 CST 2017 until: Fri Aug 11 08:03:38 CST 2047
Certificate fingerprints:
      MD5:  DD:89:BB:7A:E2:49:66:E0:B5:2F:9C:CF:DB:3B:AB:26
      SHA1: 7B:DE:EF:7E:4A:25:8E:F8:08:0B:8D:28:32:0A:0A:3C:C6:50:D5:CB
      SHA256:
27:E0:B8:9C:6B:4F:C6:88:25:7E:34:6E:93:7D:6C:F2:58:AC:64:02:2A:44:BB:17:23:19:E8:F4:8C:17:E6:30
      Signature algorithm name: SHA256withRSA
      Version: 3
 
Extensions:
 
#1: ObjectId: 2.5.29.14 Criticality=false
SubjectKeyIdentifier [
  KeyIdentifier [
  0000: 34 D2 8F 7A D4 AE FB 04   A8 0D 0E 7A D6 8C 3C 00 4..z.......z..<.
  0010: 9B 71 5A 61                                        .qZa
  ]
]

*******************************************
*******************************************
```

可以为**keystore**文件设置一个口令，增强访问的安全限制。Android的debug.keystore口令就是`android`，我们通过Eclipse/Android Studio开发应用时，默认就会使用debug.keystore进行签名。该文件描述了以下信息：

- keystore的文件格式为JSK(Java Key Store)，技术提供商为SUN公司。

- keystore存了一个记录：名为androiddebugkey的密钥对，其中有一个私钥和一条证书链，证书链中只有一个证书。

- 证书的持有者和发布者都是`CN=Android Debug, O=Android, C=US`，Common Name是Android Debug，Organization Name是Android，Country是US。

- 证书的有效期2017-8-18到2047-8-11；分别用MD5，SHA1，SHA256三种不同的Hash算法计算出了证书的指纹。

- 证书中的公钥是采用RSA 1024算法生成的，格式是**X.509**，上述所定义的各种属性字段，就是**X.509**的标准。

本节不再罗列**keytool**命令的其他参数，后文中还会使用keytool查看APK的签名信息。其实，最重要的还是理解几个关键概念：**证书**、**证书链**、**证书认证机构**，在当下的安全体系中，这几个概念出现的相当多，最有名的当属**HTTPS**。

# 2 Android使用数字签名的场景

笔者把Android中数字签名的应用场景分为应用和系统两个层面，先抛出具体的场景，后文中再通过源码分析这些场景的实现方式。

- 应用层面：Android对APK的签名要求

  - Android拒绝安装没有签名的APK
  - Android并不校验证书的合法性
  - 当签名不匹配时，APK升级会失败

- 系统层面：Android基于数字签名的一些机制

  - 编译Android系统时，会根据不同应用的类型进行签名
  - Android基于数字签名来判定是否给应用授权
  - Android基于数字签名来标记APK的SELinux Lable

## 2.1 未签名的APK VS 签名后的APK

Android中的数字签名主要是针对APK的，因此有必要先介绍APK签名前后的差异。使用JDK的工具`jarsigner`便可对APK进行签名。

```console
duanqizhi@xo:~$ jarsigner -verbose \
   -keystore ~/.android/debug.keystore \
   -signedjar app-signed.apk app-unsigned.apk \
   androiddebugkey
Enter Passphrase for keystore:  #此处输入密钥android
  updating: META-INF/MANIFEST.MF
    adding: META-INF/ANDROIDD.SF
    adding: META-INF/ANDROIDD.RSA
   signing: AndroidManifest.xml
   signing: classes.dex
   signing: res/anim-v21/design_bottom_sheet_slide_in.xml
   signing: res/anim-v21/design_bottom_sheet_slide_out.xml
   signing: res/anim/abc_fade_in.xml
   ... #此处省略很多对其他文件的signing日志
   signing: resources.arsc
jar signed.
```

该命令使用了前文介绍的Android Studio默认的**keystore**文件，其中存放了一对别名为**androiddebugkey**的密钥对。加上`-verbose`参数可以打印出具体对哪些文件进行过签名。

APK文件其实就是压缩包，可以通过zip或tar等工具直接解压打开，对比签名前后的APK内容如下：

```
app-unsigned                    app-signed
├── AndroidManifest.xml         ├── AndroidManifest.xml
├── classes.dex                 ├── classes.dex
├── META-INF                    ├── META-INF
│   │                           │   ├── ANDROIDD.RSA
│   │                           │   ├── ANDROIDD.SF
│   └── MANIFEST.MF             │   └── MANIFEST.MF
├── res                         ├── res
└── resources.arsc              └── resources.arsc
```

由此可见，APK签名前后，只有META-INF目录发生了变化，签名后会更新**MANIFEST.MF**文件，会增加**ANDROIDD.SF**和**ANDROIDD.RSA**这两个文件，这与使用`jarsigner`签名时的日志输出是一致的。那么，**META-INF/**目录下，变化的这三个文件到底是什么呢？

**MANIFEST.MF**和**ANDROIDD.SF**都是文本文件，直接打开可以看到其文件内容，通过`bcompare`对比工具查看其文件差异，截图片段如下图所示：

<div align="center"><img src="/assets/images/digitalsignature/4-digital-signature-manifest-unsigned-vs-signed.png" alt="清单文件"/></div>

**MANIFEST.MF**是APK包含文件的清单列表，记录了APK中每一个文件的SHA256摘要，前文介绍数字签名的时候说过，签名算法很耗时，因此不是对原文件执行加密算法，而是先生成原文件的摘要，再对摘要进行签名。由此，可以推断出**ANDROIDD.MF**文件的内容就是摘要密文。

**ANDROIDD.RSA**其实是数字证书，RSA的文件后缀表示证书中包含了一个基于RSA算法生成的公钥。通过前文介绍的`keytool`命令，便可打印出该证书的信息，这与前文中keystore中打印的证书信息是一致的：

```console
duanqizhi@xo:~/app-signed/META-INF$ keytool --printcert
-file ANDROIDD.RSA
Owner: CN=Android Debug, O=Android, C=US
Issuer: CN=Android Debug, O=Android, C=US
Serial number: 588a6601
Valid from: Wed Aug 18 08:03:38 CST 2017 until: Fri Aug 11 08:03:38 CST 2047
Certificate fingerprints:
      MD5:  DD:89:BB:7A:E2:49:66:E0:B5:2F:9C:CF:DB:3B:AB:26
      SHA1: 7B:DE:EF:7E:4A:25:8E:F8:08:0B:8D:28:32:0A:0A:3C:C6:50:D5:CB
      SHA256:
27:E0:B8:9C:6B:4F:C6:88:25:7E:34:6E:93:7D:6C:F2:58:AC:64:02:2A:44:BB:17:23:19:E8:F4:8C:17:E6:30
      Signature algorithm name: SHA256withRSA
      Version: 3
 
Extensions:
 
#1: ObjectId: 2.5.29.14 Criticality=false
SubjectKeyIdentifier [
KeyIdentifier [
0000: 34 D2 8F 7A D4 AE FB 04   A8 0D 0E 7A D6 8C 3C 00 4..z.......z..<.
0010: 9B 71 5A 61                                        .qZa
]
]
```

**至此，APK签名前后的差异已经分析完毕。签名会在APK中的META-INF/目录下添加证书ANDROIDD.RSA和密文ANDROIDD.SF，有了这两个文件，就可以对APK进行校验了。**

## 2.2 应用层面：Android对APK的签名要求

### 2.2.1 Android拒绝安装没有签名的APK

通过命令行`adb install`安装一个没有签名的APK时，会提示**INSTALL_PARSE_FAILED_NO_CERTIFICATES**错误：

```
duanqizhi@xo:$ adb install app-release-unsigned.apk
5927 KB/s (2357317 bytes in 0.388s)
Failure [INSTALL_PARSE_FAILED_NO_CERTIFICATES: Package /data/app/vmdl1995237626.tmp/base.apk has no certificates at entry AndroidManifest.xml]
```

同时，会出现如下日志：

```console
1034  1271 E PackageInstaller: Commit of session 1995237626 failed: Package /data/app/vmdl1995237626.tmp/base.apk has no certificates at entry AndroidManifest.xml
1034 11776 W System.err: java.lang.SecurityException: Caller has no access to session 1995237626
1034 11776 W System.err: at com.android.server.pm.PackageInstallerService.abandonSession(PackageInstallerService.java:737)
1034 11776 W System.err: at android.content.pm.IPackageInstaller$Stub.onTransact(IPackageInstaller.java:97)
1034 11776 W System.err: at android.os.Binder.execTransact(Binder.java:574)
```

要深入理解这些日志，需要对adb安装APK的原理有了解，然后才能分析Android是如何在APK安装路径上植入签名检查的。

通过adb安装APK的时序可以分为三步：**创建安装Session**、**拷贝APK到手机上**和**安装APK**。这里引入了Session(会话)的概念，之所以要用Session，是为了保证安装过程中的数据不会丢失：如果一个APK的安装因为某种原因中断，那么下次系统重启后仍可以继续之前的安装过程。了解Session的用意后，我们接着分析adb安装APK的时序：如下图所示：

<div align="center"><img src="/assets/images/digitalsignature/5-digital-signature-install-apk.png" alt="APK的安装过程"/></div>

1. **创建安装的Session**。这里出现的关键类是[Pm.java]()，它是包管理相关的命令解析器。通过命令行输入`adb install`或`adb shell package`命令就会交由Pm进行解析，对输入的命令解析完后，真正创建Session的操作是通过跨进程调用到[PackageInstallerService.java]()中完成的。PackageInstallerService是运行在系统进程的，伴随着PackageManagerService的创建而创建，它的主要职责就是为安装APK服务，提供了很多操作Session的接口，其内部会维护所有安装的Sesssion，并将其Session的信息保存到磁盘文件**/data/system/install_sessions.xml**中，如果有安装有中断，则下次从该文件中读取信息便可恢复Session。

    ```
    Pm.run()
    └── Pm.runInstall()
        └── Pm.doCreateSession()
            └── IPackageInstaller.createSession()
                └── Binder.execTransact()
                    ...
                    └── PackageInstallerService.createSession()
    ```

2. **拷贝APK到手机**。Session创建完后，要做的第一件事就是将待安装的APK拷贝到手机上，拷贝到手机上的哪个目录呢？创建Session的时候会根据APK的安装属性来做判定：如果安装到内置存储空间(通常就是Data分区)，那会将APK拷贝到**/data/app/vmdl+sessionId+.tmp/**目录下；如果安装到外置存储空间(通常就是SD卡)，那么将APK拷贝到外置存储空间**/smdl+sessionId+.tmp/**目录下，此处的sessionId是唯一的。在上文的日志中出现的/data/app/vmdl1995237626.tmp/base.apk其实表示当时安装的sessionId是**1995237626**。

3. **安装APK**。前面的步骤创建了一个Session，保存了一些安装信息，并将APK拷贝到手机上，这个状态称为**Staged**，是一个临时状态，在安装APK时可以看到很多与**Stage**相关的关键字。对于一个Session而言，需要进行提交(commit)，交给系统完成后续的安装操作。上文的时序图并没有把完整的函数调用逻辑示意出来，其实Session的commit操作路径还是较长的，具体如下：

    ```
    Pm.run()
    └── Pm.runInstall()
        └── Pm.doCommitSession()
            └── PackageInstaller.commit()
                └── IPackageInstallerSession.commit()
                    └── Binder.execTransact()
                        ...
                        └── PackageInstallerSession.commit()
                            └── sendMessage(MSG_COMMIT)

    Handler.Callback.handleMessage(MSG_COMMIT)
    └── PackageInstallerSession.commitLocked()
        └── PackageInstallerSession.validateInstallLocked()
            └── PackageParser.parseApkLite()
                └── PackageParser.collectCertificates()
                    └── PackageParser.loadCertificates()
        └── PackageManagerService.installStage()
    ```

    本文不再赘述路径上各函数的功能，只提出一点：要想知道APK中是否包含签名，就需要对读取APK文件的内容，这是由**PackageParser.parseApkLite()**完成的，在读取APK时，就会去找签名，这是通过**PackageParser.loadCertificates()**完成的。如果找不到签名，则会**INSTALL_PARSE_FAILED_NO_CERTIFICATES**异常，中断安装过程；如果找到签名，则会继续调用**PackageManagerService.installStage()完成后续的安装操作，更多安装操作的细节，请参考[Android包管理机制](/2017-01-04-Package-Manage-Mechanism)一文。

> 我们可以从数据库的事务操作来理解一个session，安装一个APK就可以理解为向系统添加一项APK记录的事务操作。创建一个事务(createSession)，表达操作意图(writeSession)，然后将事务提交(commitSession)。剩下的事情就交由系统完成了，系统进程会进入APK的安装阶段。

理解了APK安装过程后，我们再回过头来看一下上文中提示安装错误的日志：

```console
1034  1271 E PackageInstaller: Commit of session 1995237626 failed: Package /data/app/vmdl1995237626.tmp/base.apk has no certificates at entry AndroidManifest.xml
```

对于**1995237626**这个Session而言，Commit的时候出现了错误，这表示Session已经进入到了Commit阶段，APK已经拷贝到手机上**/data/app/vmdl1995237626.tmp/base.apk**(取名为base.apk是与APK的拆分有关，如果没有拆分，那base.apk就是待安装的APK)。出错的原因是找不到AndroidManifest.xml这个文件的证书，其实就是没有APK中没有签名信息啦~

### 2.2.2 Android不校验证书的合法性

Android拒绝安装没有签名的APK，但Android并不会校验APK证书的有效性，即只要签名正确，不管证书是不是合法的，Android都会安装。我们可以使用`jarsigner`工具对APK的证书进行校验，会出现如下的警告，但APK依旧可以正常安装。

```java
duanqizhi@xo:~$ jarsigner -verify app-signed.apk
jar verified.

Warning:
This jar contains entries whose certificate chain is not validated.
This jar contains signatures that does not include a timestamp.
Without a timestamp, users may not be able to validate this jar after the signer certificate's expiration date (2047-08-11) or after any future revocation date.
```

由于Android并不校验证书的合法性，因此我们无法判定一个安装的应用是否经由正规的公司发布。譬如，我们可以给微信进行重新签上自己生成的签名，还是可以正常安装，但这已经不是腾讯发布的微信了，Android系统对此并不感知。当然，微信自己会进行签名校验，发现签名不对会选择自行退出，但对于市面上绝大多数应用而言，都没有自校验签名。因此也就出现了一些无良的开发者，窃取别人的劳动成果，在已有APK中植入广告，重签名进行发布。

> 数字签名的证书是可以交由第三方机构认证的，即由**CA(Certifiacte Authoriy)**颁发的证书是得到认可的。基于此，应用市场(譬如应用宝、豌豆荚等)可以对上架的应用进行证书的校验。

### 2.2.3 当签名不匹配时，APK升级会失败

如果一个APK的前后两个版本签名不一致，Android是拒绝升级的，这是一种基于数字签名对应用的保护机制。在此限定下，应用开发者需保持其签名一直不变。

本文不再细述APK升级安装的过程，这个过程由PMS处理，读者其实可以猜到，无非就是在安装多了一个环节：与已安装的同包名应用进行签名比对。具体的细节可以参考[Android包管理机制](/2017-01-04-Package-Manage-Mechanism/)文中的应用安装一节。

举一个例子，对一个应用签两次不同的名，通过`adb install -r`命令重复安装，便会升级签名不匹配的错误：

```java
duanqizhi@xo:~$ adb install -r app-signed-changed.apk
1904 KB/s (2407277 bytes in 1.234s)
Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package com.xo.demo signatures do not match the previously installed version; ignoring!]
```

## 2.3 系统层面：Android基于数字签名的一些机制

### 2.3.1 四种不同类型的签名

Android预置的系统应用都是需要签名的，包括联系人、相机、设置等。Android设计了四种不同类型的签名：**platform**, **share**, **media**和**testkey**，默认置于在源码的**build/target/product/security**目录下，分别用于给不同类型的系统应用进行签名。从Android Lollipop开始，Android还对boot.img和system.img进行签名以防被篡改，所以在原来四组签名的基础上又增加了**verity**。

```
build/target/product/security
├── (media.pk8, media.x509.pem)       #用于给MediaProvider, Gallery等签名
├── (platform.pk8, platform.x509.pem) #用于给Settings, Phone等签名
├── (shared.pk8, shared.x509.pem)     #用于给Launcher, Dailer等签名
├── (testkey.pk8, testkey.x509.pem)   #用于给一般应用签名
└── (verity.pk8, verity.x509.pem)     #用于给boot.img和system.img签名
```

一共有五组密钥对，**.pk8**为私钥, **.509.pem**为证书(包含公钥)，本质上，它们都是密钥对，并没有区别，只不过Android做了逻辑上的区分，后文我们再来介绍不同类型的签名各有什么用。先来看如何给系统应用设定签名类型，以下是[packages/apps/Settings/Android.mk]()的内容片段，表示要编译Settings这个模块：

```makefile
LOCAL_PATH:= $(call my-dir)
include $(CLEAR_VARS)
...
LOCAL_PACKAGE_NAME := Settings
LOCAL_CERTIFICATE := platform  #表示Settings需要采用platform密钥对进行签名
LOCAL_PRIVILEGED_MODULE := true
...
include $(BUILD_PACKAGE)
```

设置Makefile的**LOCAL_CERTIFICATE**变量，就可以指定APK的签名类型了，编译系统会根据设定的变量值选取密钥对。

> 在AOSP的源码中，上述的密钥对是完全公开的，只是为了完成签名操作，并没有安全性可言。OEM设备厂商都会自行生成密钥对，并将私钥(.pk8文件)保护起来。

### 2.3.2 应用的授权

在[Android包管理机制](/2017-01-04-Package-Manage-Mechanism/)一文中，详细介绍了系统如何给应用授权，本文不再赘述，仅把与数字签名相关的应用授权提炼出来。

先来看一个特殊的APK：framework-res.apk，其包名为**android**，在它的AndroidManifest.xml文件中，定义了一些系统权限：

```xml
  <!-- 安装应用的权限 -->
  <permission android:name="android.permission.INSTALL_PACKAGES"
      android:protectionLevel="signature|privileged" />
  <!-- 卸载应用的权限 -->
  <permission android:name="android.permission.DELETE_PACKAGES"
      android:protectionLevel="signature|privileged" />
```

所有定义的权限都有一个**protectionLevel**属性，它表示一个权限的保护级别。其中部分权限的**protectionLevel**值包含signature，表示该权限的申请者必须与framework-res.apk的签名相同，系统才会授予申请者该权限。从framework-res.apk的Android.mk中，可以看出它签名类型为platform，这也就意味着如果想要获取系统中protectionLevel为signature的权限，就必须使用platform密钥对来签名应用。

除了framework-res.apk，其他应用也可以定义属于自己的权限，同样可以设定**protectionLevel**，通过Android的权限授予机制来保护API，防止滥用。譬如在[packages/apps/Launcer3/AndroidManifest.xml]()中，就定义了如下权限：

```xml
<permission
    android:name="com.android.launcher3.permission.WRITE_SETTINGS"
    android:permissionGroup="android.permission-group.SYSTEM_TOOLS"
    android:protectionLevel="signatureOrSystem"
    android:label="@string/permlab_write_settings"
    android:description="@string/permdesc_write_settings"/>
```

这就表明要想获取**com.android.launcher3.permission.WRITE_SETTINGS**这个权限，申请者要么与Launcher3具有相同的签名，要么是一个系统应用。

正常情况下，普通的应用是无法获取一些受保护系统权限的，因为无法获得与系统应用相同的签名。试想如果一个恶意的应用获取了静默安装的系统权限，每天偷偷的下载安装应用，这是一件多么恐怖的事情。

> Android基于数字签名设计的应用授权，是一种灵活的授权机制，因为仅仅通过是否为系统应用来判定是否授权，有很多局限，譬如一些受信的应用没有安装在系统分区，就无法获取系统权限；两个普通的应用之间也无法定义受保护的权限。
> 有了数字签名，就相当于多了一种受信机制。两个不同的APK，签名相同，意味着来源相同，彼此是受信的。

### 2.3.3 SELinux根据签名给APK打标签(Labling)

Android Lollipop强制使用SELinux后，极大的增强了Android系统的安全性，关于SELinux的运行机制，各位读者可以从网上搜罗很多，本节意不在此，仅是为了介绍Android如何结合SELinux和数字签名为APK打上标签(所谓“标签”，是为了后文中描述的方便，在SELinux的概念中，其实叫SELinux Context)。有一些必要基础的背景知识：

- 在SELinux环境下，所有的文件和进程都有标签(通过`ls -Z`和`ps -Z`命令可以查看)，这个标签称为SELinux Context，是SELinux的权限控制的基础。

- 部分标签是事先定义好的，譬如[system/sepolicy/file_contexts]()文件中所定义的一些系统文件和目录的标签；部分标签是根据规则生成的，譬如在fork子进程时，会根据TE(Type Enforcement)文件中定义的规则，为子进程打上标签。

以Settings为例，手机上的系统分区会存在Settings.apk这个静态的文件，运行`ls -Z`命令可以查看其SELinux标签：

```console
angler:/system/priv-app/Settings # ls -Z
-rw-r--r-- 1 root root u:object_r:system_file:s0 Settings.apk
```

Settings.apk的标签为**u:object_r:system_file:s0**，表示：

- 该文件属于SELinux的用户u，Android下的SELinux只定义了一个用户，就是u

- 该文件的角色为object_r，SELinux的规则文件中为不同的角色定义了不同的权限

- 该文件的域为system_file，域的概念不是很好理解，姑且将其理解为操作对象，还有其他的域，譬如system_data_file, apk_data_file等，SELinux的规则文件中定义了一个角色对不同对象的操作权限

- MLS(Multi-Level Security)级别0，目前Android中所有Label的级别都是S0，此处不展开讨论

这个静态的Settings.apk文件的SELinux标签是怎么打上去的呢？在[system/sepolicy/file_contexts]()文件中做了如下定义：

```
...
#############################
# System files
#
/system(/.*)?		u:object_r:system_file:s0
/system/bin/atrace	u:object_r:atrace_exec:s0
/system/bin/e2fsck	--	u:object_r:fsck_exec:s0
/system/bin/fsck\.f2fs	--	u:object_r:fsck_exec:s0
/system/bin/fsck_msdos	--	u:object_r:fsck_exec:s0
/system/bin/toolbox	--	u:object_r:toolbox_exec:s0
...
```

上面的代码片段表示对于**/system/**目录下的所有文件，如果没有特殊的指定，其SELinux标签就为**u:object_r:system_file:s0**。**/system/**子目录也可以再重新指定，譬如**/system/bin/toolbox**，虽然也在**/system**目录下，但具体指定了其标签为**u:object_r:toolbox_exec:s0**。

当Settings运行起来后，系统中就存在一个Settings进程，通过运行`ps -Z`命令查看：

```
angler:/system/priv-app/Settings # ps -Z | grep settings
u:r:system_app:s0 system S com.android.settings
```

对于Settings进程而言，SELinux标签的角色为r，域为system_app，这个标签与静态的Settings.apk文件不同，它是依据APK的签名打上去的，Android设计了一套为应用进程打标签的机制：维护签名到SELinux标签的映射表，记录在[system/sepolicy/mac_permissions.xml]()中，其初始内容如下所示：

```xml
<?xml version="1.0" encoding="utf-8"?>
<policy>
    <signer signature="@PLATFORM" >
      <seinfo value="platform" />
    </signer>
</policy>
```

以上内容只是一个模板，表达的意思是：签名为**@PLATFORM**的APK所在的进程，其seinfo为platform。**@PLATFORM**编译后会被替换成真实的platfrom类型的签名，以下是mac_permissions.xml经过编译后的结果：

```xml
<?xml version="1.0" encoding="iso-8859-1"?>
<policy>
  <signer signature="308204a83...8b1b357">
    <seinfo value="platform"/>
  </signer>
</policy>
```

对于在Android.mk中声明**LOCAL_CERTIFICATE := platform**的应用来说，其seinfo就被标记为**platform**了，那么**seinfo**又是什么呢？[frameworks/base/core/java/android/content/pm/ApplicationInfo.java]()文件中有其定义：

```java
    /**
     * String retrieved from the seinfo tag found in selinux policy. This value
     * can be overridden with a value set through the mac_permissions.xml policy
     * construct. This value is useful in setting an SELinux security context on
     * the process as well as its data directory. The String default is being used
     * here to represent a catchall label when no policy matches.
     *
     * {@hide}
     */
    public String seinfo = "default";
```

**ApplicationInfo**这个对象是表示一个应用程序的信息，其中一个属性就是**seinfo**，默认取值为default，最终取值会依据**mac_permissions.xml**而定。在**system/sepolicy/seinfo_contexts**文件中，定义了不同**seinfo**映射到的SELinux标签：

```
isSystemServer=true domain=system_server
user=system seinfo=platform domain=system_app type=system_app_data_file
user=bluetooth seinfo=platform domain=bluetooth type=bluetooth_data_file
user=nfc seinfo=platform domain=nfc type=nfc_data_file
user=radio seinfo=platform domain=radio type=radio_data_file
user=shared_relro domain=shared_relro
user=shell seinfo=platform domain=shell type=shell_data_file
user=_isolated domain=isolated_app levelFrom=user
user=_app seinfo=platform domain=platform_app type=app_data_file levelFrom=user
user=_app isAutoPlayApp=true domain=autoplay_app type=autoplay_data_file levelFrom=all
user=_app isPrivApp=true domain=priv_app type=app_data_file levelFrom=user
user=_app domain=untrusted_app type=app_data_file levelFrom=user
```

**Settings**进程的seinfo为platform，进程所属的用户为system，那就匹配到了**"user=system seinfo=platform domain=system_app type=system_app_data_file"**这一条，表示Settings进程的域为**system_app**，其可操作的文件类型为**system_app_data_file**。

当APK的签名在**mac_permissions.xml**中没有匹配成功时，会默认设置seinfo为default，这样最终APK的应用进程的域就为**untrusted_app**。感兴趣的读者可以自行通过上文中的命令查看。

用下图总结一下为应用进程打标签的过程：

<div align="center"><img src="/assets/images/digitalsignature/6-digital-signature-selinux-labeling.png" alt="APK打标签的过程"/></div>

- 对APK进行扫描的时候，根据**mac_permissions.xml**中定义的`签名=>seinfo`映射，设置APK所对应的应用进程的seinfo属性

- 当APK的应用进程启动时，根据**seapp_contexts**中定义的`seinfo=>SELinux Context`映射，设置进程的SELinux标签

# 3 总结

本文的目的是为了介绍数字签名在Android中的应用场景。

首先，介绍了数字签名的背景，机制和常见的使用工具。对于数字签名(Digitial Signature)、电子签名(Electronic Signature)、证书(Certificate)、证书链(Certificate Chain)、证书认证机构(Certificate Authority)等概念做了比较通俗的解释。数字签名的实现基于非对称密钥算法，主要有签名和校验两个机制。使用数字签名可以保障可认证性(Authentication)、不可抵赖性(Non-repudiation)和完整性(Integrity)，因此应用场景非常之广泛，譬如SSH、HTTPS、网银U盾、电子合同等。

然后，分析了Android基于数字签名实现的一些安全机制，包括拒绝安装没有签名的应用、拒绝升级签名不匹配的应用、基于签名给应用授权、SELinux环境下基于签名打标签。在Android源码中，都能够找到这些机制的实现，读者可以重点学习Android是如何将数字签名机制嵌入到已有的代码流程中的。

最后，数字签名还可以衍生出一些有意思的变种，譬如如何做到可抵赖(Repudiation)，这在间谍领域是很有必要的，基于本文一开始提到的**Diffie-Hellman Key Exchange**算法就可以实现可抵赖性，有兴趣的读者可以继续研究。