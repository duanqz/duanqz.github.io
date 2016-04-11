---
    layout: null
---

/**
 * 页面ready方法
 */
$(document).ready(function() {
    generateContent();
    share();
//    disqus();
});

/**
 * 侧边目录
 */
function generateContent() {
    var $mt = $('.toc');
    var $toc;
    $mt.each(function(i,o){
        $toc = $(o);
        $toc.toc({ listType: 'ul', headers: 'h1, h2, h3' });
    });
}

function share(){
    window._bd_share_config={"common":{"bdSnsKey":{},"bdText":"","bdMini":"2","bdMiniList":false,"bdPic":"","bdStyle":"0","bdSize":"16"},"share":{},"image":{"viewList":["tsina","weixin","copy"],"viewText":"分享到：","viewSize":"16"},"selectShare":{"bdContainerClass":null,"bdSelectMiniList":["tsina","weixin","copy"]}};
    with(document)0[(getElementsByTagName('head')[0]||body).appendChild(createElement('script')).src='https://bdimg.share.baidu.com/static/api/js/share.js?v=89860593.js?cdnversion='+~(-new Date()/36e5)];
}

function disqus(){
    /* * * CONFIGURATION VARIABLES * * */
    var disqus_shortname = '{{site.disqus_shortname}}';

    var dsq = document.createElement('script'); dsq.type = 'text/javascript'; dsq.async = true;
    dsq.src = '//' + disqus_shortname + '.disqus.com/embed.js';
    document.getElementsByTagName("script")[0].parentNode.appendChild(dsq);
}
