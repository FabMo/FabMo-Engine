var moment = require('../../../static/js/libs/moment.js');
module.exports = function users(fabmo) {
setupUserManager();
var current_user=null;

function setupUserManager() {
  fabmo.getCurrentUser(function(err,user){
    if(err)fabmo.notify('error',err);
    else{
      current_user = user;
      refreshCurrentUserView(user);
      if(user.isAdmin){
        createAdminPanel();
      }
    }
  });

  $("#submit-user-password").one('click',function(e){
    password=$('#input-user-password').val();
    password_confirm = $('#input-user-passwordConfirmation').val();
    $('#input-user-password').val('');
    $('#input-user-passwordConfirmation').val('');
    if(password===password_confirm){
      user = current_user;
      user_info= {
        user:{
          id:current_user._id,
          password:password
        }
      };
      fabmo.modifyUser(user_info,function(err){
        if(err)fabmo.notify('error',err);
        else{
          fabmo.notify('success',"password successfully changed for user "+current_user.username);
        }
        setupUserManager();
      });
    }
    else{
      fabmo.notify('error',"passwords don't match");
    }
  });
}


function createAdminPanel(){
  fabmo.getUsers(function(err,users) {
    if(err){return;} // user is not admin.
    users=users.filter(function(usr){return(usr._id!==current_user._id)}); //remove current user from the list
    refreshUsersListView(users);
  });

  $('#add-user').one('click',function() { //add new user
    form=[
      '<div id="adduser-modal" class="reveal-modal medium" data-reveal>',
        '<div id="modal-title">Add User</div>',
        '<div id="adduser-form">',
            '<div class="row">',
                '<label for="adduser-username">Username :</label>',
                '<input id="adduser-username" type="text" name="adduser-username" value="" />',
            '</div>',
            '<div class="row">',
                '<label for="adduser-password">New Password :</label>',
                '<input id="adduser-password" type="password" name="adduser-password" value="" />',
            '</div>',
            '<div class="row">',
                '<label for="adduser-name">Confirm New Password:</label>',
                '<input id="adduser-passwordConfirmation" type="password" name="adduser-passwordConfirmation" value="" />',
            '</div>',
            '<div class="row">',
                 '<div class="right">',
                     '<button id="adduser-cancel" class="button radius alert">Cancel</button>',
                     '<button id="adduser-submit" class="button radius success">Add User</button>',
                 '</div>',
             '</div>',
         '</div>',
         '<a class="close-reveal-modal" id="close-adduser-modal">&#215;</a>',
        '</div>',
    ].join('');
    $('body').append(form);
    $('#adduser-modal').foundation('reveal', 'open');
    $('#adduser-username').focus();
    $('#adduser-submit').one('click', function( event ) {
      username = $('#adduser-username').val();
      password = $('#adduser-password').val();
      password_confirm = $('#adduser-passwordConfirmation').val();
      if(password===password_confirm){
        user_info= {
          user:{
            username:username,
            password:password
          }
        };
        fabmo.addUser(user_info, function(err,user) {
          if (err) {
              fabmo.notify('error', err);
          }else{
              fabmo.notify('success', 'User '+user.username+' created !');
          }
          createAdminPanel();
        });
      }else{
        fabmo.notify('error',"passwords don't match"+event);
      }
      $('#adduser-modal').foundation('reveal', 'close');
      $("#adduser-form").trigger('reset');
      $("#adduser-submit").off('click');
      $("#adduser-modal").remove();
    });
    $('#adduser-modal').bind('closed.fndtn.reveal', function (event) {
        $("#adduser-submit").off('click');
        $("#adduser-modal").remove();
    });
    $('#adduser-cancel').on('click',function(evt) {
      evt.preventDefault();
      $('#adduser-modal').foundation('reveal', 'close');
      $("#adduser-submit").off('click');
      $("#adduser-modal").remove();
    });

  });


}


function refreshCurrentUserView(current_user){
  $("#user-username").val(current_user.username);
  $("#user-_id").val(current_user._id);
  $("#user-isAdmin").prop( "checked",current_user.isAdmin);
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
          '<td><input type="checkbox" '+(user.isAdmin?'checked':'')+' disabled /></td>', // isAdmin
          '<td>'+moment(user.created_at).fromNow()+'</td>', // created_at
          '<td>'+changepassword_button+'</td>', // change_password_button
          '<td>'+(user.isAdmin?revokeadmin_button:grantadmin_button)+'</td>', // grant/revoke admin button
          '<td>'+delete_button+'</td>', // delete button
        '</tr>',
      ].join('');
      $(".user-listing").append(html);

      $('#delete_' + userid).on('click',function() { //delete button listener
        fabmo.showModal({
          title : 'Delete user '+ user.username,
          message : 'Are you sure you want to delete this user?',
          okText : 'Yes',
          cancelText : 'No',
          ok : function() {
            fabmo.deleteUser({user:user}, function(err) {
            if (err) {
              fabmo.notify('error', err);
            }else{
              fabmo.notify('success','user '+user.username+' deleted !')
            }
            createAdminPanel();
            });
          },
          cancel : function() {}
        })
      });

      $('#grantadmin_' + userid).on('click',function() { //grantadmin button listener
        user_info = {
          user :{
            id:user._id,
            isAdmin:true
          }
        };
        fabmo.modifyUser(user_info, function(err) {
        if (err) {
          fabmo.notify('error', err);
        }else{
          fabmo.notify('success','admin permission granted to user '+user.username)
        }
        createAdminPanel();
        });
      });

      $('#revokeadmin_' + userid).on('click',function() { //revokeadmin button listener
        user_info = {
          user :{
            id:user._id,
            isAdmin:false
          }
        };
        fabmo.modifyUser(user_info, function(err) {
        if (err) {
          fabmo.notify('error', err);
        }else{
          fabmo.notify('success','admin permission removed for user '+user.username)
        }
        createAdminPanel();
        });
      });

      $('#changepassword_' + userid).on('click',function() { //change user password
        form=[
          '<div id="changepassword-modal" class="reveal-modal medium" data-reveal>',
            '<div id="modal-title">Change user '+user.username+'\'s password</div>',
            '<div id="changepassword-form">',
                '<div class="row">',
                    '<label for="changepassword-password">New Password :</label>',
                    '<input id="changepassword-password" type="password" name="changepassword-password" value="" />',
                '</div>',
                '<div class="row">',
                    '<label for="changepassword-name">Confirm New Password:</label>',
                    '<input id="changepassword-passwordConfirmation" type="password" name="changepassword-passwordConfirmation" value="" />',
                '</div>',
                '<div class="row">',
                     '<div class="right">',
                         '<button id="changepassword-cancel" class="button radius alert">Cancel</button>',
                         '<button id="changepassword-submit" class="button radius success">Change Password</button>',
                     '</div>',
                 '</div>',
             '</div>',
             '<a class="close-reveal-modal" id="close-changepassword-modal">&#215;</a>',
            '</div>',
        ].join('');
        $('body').append(form);
        $('#changepassword-modal').foundation('reveal', 'open');
        $('#changepassword-password').focus();
        $('#changepassword-submit').one('click', function( event ) {
          password = $('#changepassword-password').val();
          password_confirm = $('#changepassword-passwordConfirmation').val();
          if(password===password_confirm){
            user_info= {
              user : {
                id : user._id,
                password:password
              }
            };
            fabmo.modifyUser(user_info, function(err) {
              if (err) {
                  fabmo.notify('error', err);
              }else{
                  fabmo.notify('success',"password successfully changed for user "+user.username);
              }
              createAdminPanel();
            });
          }else{
            fabmo.notify('error',"passwords don't match"+event);
          }
          $('#changepassword-modal').foundation('reveal', 'close');
          $("#changepassword-form").trigger('reset');
          $("#changepassword-submit").off('click');
          $("#changepassword-modal").remove();
        });
        $('#changepassword-modal').bind('closed.fndtn.reveal', function (event) {
            $("#changepassword-submit").off('click');
            $("#changepassword-modal").remove();
        });
        $('#changepassword-cancel').on('click',function(evt) {
          evt.preventDefault();
          $('#changepassword-modal').foundation('reveal', 'close');
          $("#changepassword-submit").off('click');
          $("#changepassword-modal").remove();
        });

      });
    });
  }else{
    $('#user-manager-container').addClass('hidden');
  }
}
};