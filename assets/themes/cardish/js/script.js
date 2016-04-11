---
    layout: null
---

/**
 * 页面ready方法
 */
$(document).ready(function() {

    backToTop();
    search();
});

/**
 * 回到顶部
 */
function backToTop() {
    $("[data-toggle='tooltip']").tooltip();
    var st = $(".page-scrollTop");
    var $window = $(window);
    var topOffset;
    //滚页面才显示返回顶部
    $window.scroll(function() {
        var currnetTopOffset = $window.scrollTop();
        if (currnetTopOffset > 0 && topOffset > currnetTopOffset) {
            st.fadeIn(500);
        } else {
            st.fadeOut(500);
        }
        topOffset = currnetTopOffset;
    });

    //点击回到顶部
    st.click(function() {
        $("body").animate({
            scrollTop: "0"
        }, 500);
    });


}

function search(){
//    (function(w,d,t,u,n,s,e){w['SwiftypeObject']=n;w[n]=w[n]||function(){
//        (w[n].q=w[n].q||[]).push(arguments);};s=d.createElement(t);
//        e=d.getElementsByTagName(t)[0];s.async=1;s.src=u;e.parentNode.appendChild(s);
//    })(window,document,'script','//s.swiftypecdn.com/install/v2/st.js','_st');
//
//    _st('install','{{site.swiftype_searchId}}','2.0.0');

//    (function(){
//        document.write(unescape('%3Cdiv id="bdcs"%3E%3C/div%3E'));
//        var bdcs = document.createElement('script');
//        bdcs.type = 'text/javascript';
//        bdcs.async = true;
//        bdcs.src = 'http://znsv.baidu.com/customer_search/api/js?sid=17140189356250418058' + '&plate_url=' + encodeURIComponent(window.location.href) + '&t=' + Math.ceil(new Date()/3600000);
//        var s = document.getElementsByTagName('script')[0];
//        s.parentNode.insertBefore(bdcs, s);}
//        )();
}





