var fabmo = new FabMoDashboard();
var current_user=null;

function setupUserManager() {
  getCurrentUser(function(err,user){
    if(err)fabmo.notify('error',err);
    else{
      current_user = user;
      refreshCurrentUserView(user);
      if(user.isAdmin){
        createAdminPanel();
      }
    }
  });

  $("#submit-user-password").click(function(e){
    password=$('#input-user-password').val();
    password_confirm = $('#input-user-passwordConfirmation').val();
    if(password===password_confirm){
      user = current_user;
      user.password = password;
      modifyUser(user,function(err){
        if(err)fabmo.notify('error',err);
        else{
          fabmo.notify('success',"password successfully changed for user "+current_user.username);
        }
      });
    }
    else{
      fabmo.notify('error',"passwords don't match");
    }
  });
}

function getCurrentUser(callback){
  $.ajax({
    type: "GET",
    url: "/authentication/user",
    contentType: 'application/json',
    success: function(data){
      if(data.success){
        callback(null,data.data);
      }
      else{
        callback(data.message);
      }
   },
   error:function(data){
    callback(data.responseJSON.message);
   },
   beforeSend:function(){
   }
  });
}

function addUser(username,password,callback){
  $.ajax({
    type: "POST",
    url: "/authentication/user",
    contentType: 'application/json',
    dataType: "json",
    data: JSON.stringify({username:username,password:password}),
    success: function(data){
      if(data.success){
        callback(null,data.data);
      }
      else{
        callback(data.message);
      }
    },
    error:function(data){
    callback(data.responseJSON.message);
    },
    beforeSend:function(){
    }
 });
}



function modifyUser(user,callback){
  $.ajax({
    type: "POST",
    url: "/authentication/user/"+user._id,
    contentType: 'application/json',
    data:user,
    dataType:"json",
    success: function(data){
      if(data.success){
        callback(null,data.data);
      }
      else{
        callback(data.message);
      }
   },
   error:function(data){
    callback(data.responseJSON.message);
   },
   beforeSend:function(){
   }
  });
}

function deleteUser(user,callback){
  $.ajax({
    type: "DELETE",
    url: "/authentication/user/"+user._id,
    contentType: 'application/json',
    data:user,
    dataType:"json",
    success: function(data){
      if(data.success){
        callback(null,data.data);
      }
      else{
        callback(data.message);
      }
   },
   error:function(data){
    callback(data.responseJSON.message);
   },
   beforeSend:function(){
   }
  });
}

function getUsers(callback){
  $.ajax({
    type: "GET",
    url: "/authentication/users",
    contentType: 'application/json',
    success: function(data){
      if(data.success){
        callback(null,data.data);
      }
      else{
        callback(data.message);
      }
   },
   error:function(data){
    callback(data.responseJSON.message);
   },
   beforeSend:function(){
   }
  });
}


function createAdminPanel(){
  getUsers(function(err,users) {
    if(err){return;} // user is not admin.
    users=users.filter(function(usr){return(usr._id!==current_user._id)}); //remove current user from the list
    refreshUsersListView(users);
  });
}


function refreshCurrentUserView(current_user){
  $("#user-username").val(current_user.username);
  $("#user-_id").val(current_user._id);
  $("#user-isAdmin").val(current_user.isAdmin);
  $("#user-created_at").val(moment(current_user.created_at).fromNow());
}

function refreshUsersListView(users){
  if(current_user.isAdmin){
    $('.user-listing').empty()
    $('#user-manager-container').removeClass('hidden');
    $.each(users, function(key, user) {

      userid = "user_"+user._id;

      var delete_button = '';
      var changepassword_button = '';
      var grantadmin_button = '';
      var revokeadmin_button = '';
      if(current_user.username==="admin" || (!user.isAdmin)){ // cannot edit other admin profiles (except if your the super "admin" account)
        delete_button = '<div class="delete-button" id="delete_' + userid + '"><img class="svg" src="images/recycling10.svg"></div>';
        changepassword_button = '<div class="changepassword-button" id="changepassword_' + userid + '"><img class="svg" src="images/changepassword.svg"></div>';
        grantadmin_button =  '<div class="grantadmin-button" id="grantadmin_' + userid + '"><img class="svg" src="images/grantadmin.svg"></div>';
        revokeadmin_button =  '<div class="revokeadmin-button" id="revokeadmin_' + userid + '"><img class="svg" src="images/revokeadmin.svg"></div>';
      }

      html = [
        '<tr>',
          '<td>'+user._id+'</td>', // _id
          '<td>'+user.username+'</td>', // username
          '<td><input type="checkbox" value="'+user.isAdmin+'" disabled /></td>', // isAdmin
          '<td>'+moment(user.created_at).fromNow()+'</td>', // created_at
          '<td>'+changepassword_button+'</td>', // change_password_button
          '<td>'+(user.isAdmin?revokeadmin_button:grantadmin_button)+'</td>', // grant/revoke admin button
          '<td>'+delete_button+'</td>', // delete button
        '</tr>',
      ].join('');
      $(".user-listing").append(html);

      $('#delete_' + userid).click(function() { //delete button listener
        fabmo.showModal({
          title : 'Delete app',
          message : 'Are you sure you want to delete this app?',
          okText : 'Yes',
          cancelText : 'No',
          ok : function() {
            deleteUser(user, function(err) {
            if (err) {
                fabmo.notify('error', err);
            }
            refreshUsersListView();
            });
          },
          cancel : function() {}
        })
      });

      $('#changepassword_' + userid).click(function() { //change user password
        form=[
          '<div class="large-4 columns" id="section-changepassword-password">',
            '<div class="row collapse">',
              '<label>New Password :</label>',
              '<div class="small-12 columns">',
                '<input type="password" id="changepassword-password" class="input"/>',
              '</div>',
            '</div>',
          '</div>',
          '<div class="large-4 columns" id="section-changepassword-passwordConfirmation">',
            '<div class="row collapse">',
              '<label>Confirm Password :</label>',
              '<div class="small-12 columns">',
                '<input type="password" id="changepassword-passwordConfirmation"/>',
              '</div>',
            '</div>',
          '</div>',
          '<script type="text/javascript">',
          'password=null;',
          'password_confirm=null;',
          '$("#changepassword-password").change(function(e){',
            'password = $(this).val();',
          '});',
          '$("#changepassword-passwordConfirmation").change(function(e){',
            'password_confirm = $(this).val();',
          '});',
          '</script>',
        ].join('');
        fabmo.showModal({
          title : "Modify user "+user.username+"'s password",
          message : form,
          okText : 'Change',
          cancelText : 'Cancel',
          ok : function() {
            console.log(password);
            /*
            modifyUser(user, function(err) {
              if (err) {
                  fabmo.notify('error', err);
              }
              refreshUsersListView();
            });
            */
          },
          cancel : function() {}
        },function(err){
          if(err)fabmo.notify('error',err);
        })
      });




    });
  }else{
    $('#user-manager-container').addClass('hidden');
  }
}
