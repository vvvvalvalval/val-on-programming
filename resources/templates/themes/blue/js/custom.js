$(function () {
 $('.sn').each(function(i, node){
   var e = $(node);

   e.addClass('sn--visible');
   e.prepend($('<img class="sn-avatar" src="/img/avatar.jpg" alt="avatar"/>'));
   e.append("  ");
   e.append($('<span class="sn-toggle">[hide]<span>'));
   var expandedContent = e.html();

   function show () {
     e.addClass('sn--expanded');
     e.removeClass('sn--collapsed');
     e.html(expandedContent);
     e.find('.sn-toggle').on('click', hide);
   }

   function hide() {
     e.addClass('sn--collapsed');
     e.removeClass('sn--expanded');
     e.html('<span class="sn-toggle">[note]<span>');
     e.find(".sn-toggle").on('click', show);
   }

   hide();
 });
});