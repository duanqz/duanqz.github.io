---
layout: post
category: Android启智观
title: Android数字签名机制和应用
tagline:
tags:  [Activity数字签名]
---


# 1 数字签名

## 1.1 背景

Digital Signature直译成中文就是数字签名，是Whitfield Diffie和Martin Hellman早在1976年就提出的概念，以他们名字命名的Diffie-Hellman Key Exchange算法可以用于在公开网络上传送密钥。
随后，由Ron **R**ivest, Adi **S**hamir和Leonard **A**dleman三人发明的RSA算法，被广泛运用到数字签名中。首个投放到市场的数字签名应用在1989年发布，采用的算法就是RSA。

**签名有什么用呢？**生活中，大家一定有签名表身份的经历，譬如：在刷银行卡消费时，需要签上自己的大名，收银员有时还会对比一下你签的名与银行卡上签名栏是否匹配；在签署合同时，往往需要潇洒的挥上自己的大名，甚至手抹红印，按下指纹。这些都是为了确定行为人的身份，作为后续问题追溯的依据。数字签名的**签名**两字正是源于生活，意在确定身份，而**数字**两字表明其是签名的一种类型：基于密码学的签名方式。被数字签名广泛采用的RSA算法就是一种加密算法。

**数字签名怎么用呢？**在网络发送信息时，存在安全问题，因为在发送者和接收者之间可能存在第三者，截获发送者信息，进行篡改后，再发送给接收者。为了解决这类安全问题，发送者可以对数据进行数字签名，当接收者拿到一堆签名后的数据时，可以对数据进行校验，一旦校验成功，接收者可以信心满满的说：

- 这些数据一定是某人发送过来的，可以通过其他机构确定发送人的资质。
- 发送者不可抵赖这是自己发送的，一旦接收者一口咬定数据是来源于某位发送者，那发送者只能心服首肯。
- 这些数据一定没有被篡改，否则不会通过校验。

这其实就是数字签名的三大特性：可认证性(authentication)、不可抵赖性(non-repudiation)和完整性(integrity)。即便收到被第三者篡改的数据，接收者也可以确定数据不是来源于受信的发送者，而且数据肯定被动过。

> 自古以来，手写签名、按压指纹这种传统的签名方式都是具有法律效应的。在电子信息如此发达的今天，电子签名(Electronic Signature)也是被很多国家和地区(欧盟、美国)也被立法保护。读者在接触数字签名的概念时，往往会关联到电子签名的概念，前者属于技术实现的范畴，后者属于人文律法的范畴。
>
> 人们认可电子签名在法律上的有效性，而数字签名采用一定的加密算法，来保障电子签名的这种有效性。诚然，加密算法总有过时的一天，譬如广泛应用的低位数的RSA算法就已经被破解了，这时候，电子签名的有效性就消失了，需要进一步更新数字签名的算法，继续维持电子签名的法律有效性。
>
> 这里，还需要说明一点，并非所有的电子签名实现都是采用数字签名。

## 1.2 机制

**数字签名是如何保证可认证、不可抵赖和完整性的呢？**这得从数字签名的算法说起。数字签名的实现包含三个算法：

1. 密钥生成算法。数字签名采用的是非对称密钥生成算法，即会生成一对密钥：私钥和公钥。用私钥加密的数据，只能用对应的公钥解密。私钥是应该要保护起来，不会泄露给其他人；公钥是完全公开的，会随着加密数据一起在公开网络上传送。

> 密钥有对称(symmetric)和非对称(public)之分。对称密钥只有一个，同时用于加密和解密，就像我们用同一把钥匙开门和锁门，谁拿到钥匙，谁就掌握了房间的使用权。DES和AES这种加密算法采用的是对称密钥，而上文提到的RSA算法采用的是非对称密钥。

2. 签名算法。给定私钥(private key)和数据(message)，可以生成一个签名(signature)。

3. 签名验证算法。给定数据(message)、公钥(public key)和签名(signature)，可以解密数据并验证数据的来源和完整性。

下图示意了数字签名的运行机制：

<div align="center"><img src="/assets/images/digitalsignature/1-digital-sigature-mechanisum.svg" alt="数字签名机制"/></div>

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

举一个最常见的例子，github上的开源项目均支持采用HTTP或SSH进行克隆，而采用SSH协议下载时，需要在github上添加一个**SSH Key**，否则无法正常同步github上的项目。按照操作手册，会先在本地使用**ssh-keygen**命令生成一个密钥对：

```
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

该命令执行完后，会在用户目录下的&*.ssh**子目录生成两个文件：id_rsa和id_rsa.pub。操作手册的下一步，便是将id_rsa.pub的文件内容粘贴到github的**SSH Key**中。

一般我们都是按照操作手册的要求，完成配置后便可通过SSH下载远程代码，知其然却不知其所以然。在理解了数字签名的基本概念后，再来看这个过程：

- **ssh-keygen**默认采用RSA算法生成了私钥(id_rsa)和公钥(id_rsa.pub)。上文中采用的是RSA 2048位的算法，因为256,512位的RSA算法已经被破解了。这里需要提出的是，除了RSA，还有其他密钥对的生成算法，譬如DSA(Digital Signature Algorithm)、EdDSA(Edwards-curve Digital Signature Algorithm)等，可以通过**ssh-keygen**的*-t*参数指定密钥对的生成算法。

  > 使用**ssh-keygen**生成密钥对时，会提示输入一个口令(passphrase)，用来保护私钥。口令采用的对称密钥加密算法，简单来说，口令就像银行卡密码一样，需要记在脑子里。
  >
  > 公钥通常比较长，上文中RSA算法生成的公钥是2048位，为了便于描述和比对，采用MD5算法将公钥映射成128位的Hash值，通常用16进制表示，这一串Hash值就叫做**指纹(Fingerprint)**。

- 将公钥粘贴到github的SSH Key配置项中，能够免去不断输入用户名和密码的烦恼；同时，这说明公钥是完全公开的，但私钥(id_rsa)仍然是保存在本地的。当github收到从客户端发起请求时，会利用客户端的公钥对一串随机数进行加密操作，然后将密文发送给客户端；客户端在收到密文后，会用配对的私钥进行解密，如果解密成功，便可建立一个受信的连接，不用再通过用户名和密码鉴权。

除了github，还有很多代码管理工具都支持SSH，譬如gitlab，oschina，gerrit等，其操作过程都是一致的。因为SSH利用数字签名，建立了安全的连接。

### 1.3.2 keytool

**keytool**是JDK的一个工具，用于密钥和证书的管理。**keytool**的主要操作对象是**keystore文件**，该文件一般以*.keystore或*.jks(Java KeyStore)为后缀名，用于密钥和证书的存储，其存储结构如下图所示：

<div align="center"><img src="/assets/images/digitalsignature/2-digital-sigature-keystore.png" alt="keystore的存储结构"/></div>

**keystore**可以存储多个密钥对(Key Pair)，每一个密钥对包含私钥(Private Key)和多个证书(Certificate)。想必诸位读者一定心生怪异了，上文说的密钥对都是一个私钥和一个公钥配对，然而**keystore**中存储的却是私钥和多个证书的配对，到底密钥对是怎么一样对应关系呢？这里有必要把证书和公钥的关系说明清楚了。

**证书(Certificate)**，如其名，用来证明真伪，就像一家企业的营业执照、大学生的毕业证一样，可用来证明其**标的物**的合法性，数字签名中的证书就是用于证明**公钥**的合法性。前文中提过，数字签名算法具备可认证性，然而公钥是完全公开的，很容易被伪造，这样一来，给定一个公钥是无法认证其合法性的，因此，需要给公钥“颁发”一个**证书**，其实现手段就是给公钥再签名一次，得到的结果就是**证书**。上图中，展示了一个完整的证书所包含的属性：Version、Subject、Issuer、Valid From、Valid Until、Public Key(待签名的公钥)、 Signature Algorithm(对公钥签名采用的数字签名算法)、Fingerprint(对公钥签名的公钥)。

**至此，我们知道证书和公钥的关系了：证书就是对公钥再次签名产生的结果，证书包含被签名的公钥、公钥拥有者的信息以及对公钥进行签名的公钥。**
接下来，还有两个重要的概念：**证书认证机构CA(Certificate Authority)**和**证书链(Certificate Chain)**。这两个概念在数字签名体系中经常出现，但并不容易理解。

上述证书的生成过程会导致一个无限的链条：要得到证书，就需要给公钥进行数字签名，这就有两个公钥了：证书本身的公钥(即证书中的Public Key，用公钥A表示)和数字签名算法的公钥(即证书中的Fingerprint，用公钥B表示)，要保证公钥B的合法性，我们可以对公钥B再进行数字签名，就又会引入一个新的公钥C，由此类推，还会有公钥D、E、F...，公钥合法性的保证就像链条一样：层层相扣，无穷无尽。怎么办呢？要打破这个无限的链条，就需要有一个权威机构，来统一颁发证书，这个机构就是**CA(Certificate Authority)**，只要是**CA**颁发的证书，就不需要再签名了，就是权威的。然而，全世界需要的证书太多了，光靠一个**CA**是忙不过来的，**CA**得授权一些代理，这些代理也可以颁发证书，代理颁发的证书也被认为是合法可信的，这就形成了一个证书认证的链条，即**证书链**。我们再回过来头来看一下**keystore**文件的结构：一个私钥(Private Key)与多个证书(Certificates)组成密钥对(Key Pair)，其实多个证书的结构就是**证书链**。

> 要理解**CA**和**证书链**，还是可以举毕业证的例子，我们的政府就可以看做一个**CA**，政府授权给教育部，教育部具备颁发和认证毕业证的职能；教育部再授权给各个高校，高校具备颁发自己学校毕业证的职能，教育部和高校就是不同级别的代理，授权过程就像**链条**一样。当我们要认证一个毕业证的真伪时，先拿到所属高校认证一下，如果高校无法确定合法，就拿到教育部认证一下，这种对毕业证的颁发和逐级认证的过程，就可以理解为**证书链**。

**有了这么多概念储备后，就可以轻松理解keytool这个工具的使用了。如果将keystore看做密钥和证书管理的数据库，那么keytool就是这个数据库增、删、改、查的接口。** 笔者在网上搜索keytool的使用，基本都是罗列keytool命令的各中参数，真心记不住啊！好在Eclipse/Android Studio这些IDE都集成了keysotre的图形化工具，为开发人员带来了在签名的便利。

当然，除了Eclipse/Android Studio里面的keystore操作工具，还有很多其他好用的工具，笔者通过[KeyStore Explorer](http://keystore-explorer.org/)工具打开Android的debug.keystore文件(位于~/.android/，存储了Android应用的默认签名)，可以看到如下信息：

<div align="center"><img src="/assets/images/digitalsignature/3-digital-sigature-keystore-content.png" alt="keystore的存储内容"/></div>

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

- keystore的文件格式为JSK(Java Key Store)，技术提供商为SUN公司

- keystore存了一个记录：名为androiddebugkey的密钥对，其中有一个私钥和一条证书链，证书链中只有一个证书

- 证书的持有者和发布者都是`CN=Android Debug, O=Android, C=US`，Common Name是Android Debug，Organization Name是Android，Country是US

- 证书的有效期2017-8-18到2047-8-11；分别用MD5，SHA1，SHA256三种不同的Hash算法计算出了证书的指纹

- 证书中的公钥是采用RSA 1024算法生成的，格式是**X.509**，上述所定义的各种属性字段，就是**X.509**的标准

本节不再罗列**keytool**命令的其他参数，后文中还会使用keytool查看APK的签名信息。其实，最重要的还是理解几个关键概念：**证书**、**证书链**、**证书认证机构**，在当下的安全体系中，这几个概念出现的相当多，最有名的当属**HTTPS**。