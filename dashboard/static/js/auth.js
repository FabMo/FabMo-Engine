 module.exports = function auth(){
  runAuth();
  function getUrlParameter(sParam) {
    var sPageURL = decodeURIComponent(window.location.search.substring(1)),
        sURLVariables = sPageURL.split('&'),
        sParameterName,
        i;
    for (i = 0; i < sURLVariables.length; i++) {
        sParameterName = sURLVariables[i].split('=');
        if (sParameterName[0] === sParam) {
            return sParameterName[1] === undefined ? true : sParameterName[1];
        }
    }
};
  function runAuth(){
    
    if(getUrlParameter("message")==="kicked-out"){
      $("#add_err").css('display', 'inline', 'important');
      $("#add_err").html('<div class="error"> <i class="fa fa-exclamation-circle" aria-hidden="true"></i><span>You have been kicked out from the tool.</span></div>');
    }else if (getUrlParameter("message")==="not-authenticated") {
      $("#add_err").css('display', 'inline', 'important');
      $("#add_err").html('<div class="error"> <i class="fa fa-exclamation-circle" aria-hidden="true"></i><span> You need to be authenticated to access this page.</span></div>');
  }

    $("#login_form").submit(function(e){
        e.preventDefault();
        username=$('#login_form input[name="username"]').val();
        password=$('#login_form input[name="password"]').val();
        login_request(username,password);
       return false;
     });

   };


   function login_request(username,password,kickout){
     $.ajax({
       type: "POST",
       url: "/authentication/login",
       contentType: 'application/json',
       dataType: "json",
       data: JSON.stringify({username:username,password:password,kickout:kickout}),
       success: function(data){
         console.log(data);
         if(data.status==="success"){
           $("#add_err").css('display', 'inline', 'important');
           $("#add_err").html('<div class="success"> <i class="fa fa-check" aria-hidden="true"></i><span> Successful Log in!</span></div>');
           window.location="/";

         }
         else{
           $("#add_err").css('display', 'inline', 'important');
           $("#add_err").html('<div class="error"> <i class="fa fa-exclamation-circle" aria-hidden="true"></i><span> Wrong username or password</span></div>');
         }
      },
      error:function(data){
        if(data.responseJSON.userAlreadyLogedIn){
          r= confirm(data.responseJSON.message+"\n do you want to kick this user out ? ")
          if(r){
            login_request(username,password,true); // kick the user out
          }else{
            $("#add_err").css('display', 'inline', 'important');
            $("#add_err").html('<div class="error"> <i class="fa fa-exclamation-circle" aria-hidden="true"></i><span> '+data.responseJSON.message+'</span></div>');
          }
        }else{
          $("#add_err").css('display', 'inline', 'important');
          $("#add_err").html('<div class="error"> <i class="fa fa-exclamation-circle" aria-hidden="true"></i><span> '+data.responseJSON.message+'</span></div>');
        }
      },
      beforeSend:function(){
        $("#add_err").css('display', 'inline', 'important');
        $("#add_err").html('<div class="loading"><i class="fa fa-circle-o-notch fa-spin fa-fw margin-bottom"></i><span"> Loading...</span></div>');
      }
    });
   }

   function signup_request(username,password){
     $.ajax({
       type: "POST",
       url: "/authentication/user",
       contentType: 'application/json',
       dataType: "json",
       data: JSON.stringify({username:username,password:password}),
       success: function(data){
         console.log(data);
         if(data.status==="success"){
           $("#add_err").css('display', 'inline', 'important');
           $("#add_err").html('<div class="success"> <i class="fa fa-check" aria-hidden="true"></i><span> User successfully created !</span></div>');
           window.location="/";
         }
         else{
           $("#add_err").css('display', 'inline', 'important');
           $("#add_err").html('<div class="error"> <i class="fa fa-exclamation-circle" aria-hidden="true"></i><span> '+data.message+'</span></div>');
         }
      },
      error:function(data){
        $("#add_err").css('display', 'inline', 'important');
        $("#add_err").html('<div class="error"> <i class="fa fa-exclamation-circle" aria-hidden="true"></i><span> '+data.responseJSON.message+'</span></div>');
      },
      beforeSend:function(){
        $("#add_err").css('display', 'inline', 'important');
        $("#add_err").html('<div class="loading"><i class="fa fa-circle-o-notch fa-spin fa-fw margin-bottom"></i><span"> Loading...</span></div>');
      }
    });
   }


   
   };