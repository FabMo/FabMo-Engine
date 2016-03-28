# Design notes for User Authentication in FabMo

## Objective
The purpose of this document is to capture design decisions related to User Authentication in the FabMo software framework.  It is not a formal design description, just a place to capture key design decisions relevant to implementors.

## User Authentication
User authentication in the context of this document is the process of uniquely identifying authorized users of a tool, and limiting access to the tool to a limited number of these users at one time.  This differs from *Authorization* which is the process by which the tool confirms that commands sent to the tool are only executed if the user is physically coincident with the tool.

## User Accounts
Users in FabMo are stored in a local user store with the FabMo software configuration (at the time of this writing located in `/opt/fabmo` by convention)  Below are some general statements about the properties of user accounts in FabMo:
 
### Notes on User Accounts
 * User accounts are stored in a local configuration store on the tool. 
 * User accounts are ideally stored in a secure fashion
 * User accounts in the local configuration store are not the same as any "cloud" user account
 * Eventually, user accounts may be "linked" to cloud accounts, and cloud accounts may even be used to log in to the tool, but the correspondence is always maintained to the local user

### Open Questions about User Accounts
 * Is there even a need to have more than one user account per tool?  (Or is a single "tool login" account sufficient?)
 * If there is more than one user account, is there more than one *type* of user account?  (Priveleged vs unpriveleged)
 * Which types of users (if there are multiple types) have the authority to manage other types?
 * How does one user kick off another, if they have left their device logged into a tool?
 * How does the updater fit into the activity of user authentication and account management (We definitely want to lock up the updater behind authentication)
 * Is there a default (admin?) user account for the tool that never goes away?
 * What happens if you forget your password?  How is that retrieved from the tool if at all?  

## Permissions
For the sake of simplicity, FabMo shouldn't have an elaborate permission tree at the user level.  Either you're authorized to use the tool or not.  Having said that, when permissions are considered, the two categories that always fall out quickly are "operators" and "observers" - an operator can do anything with the tool, but an observer can only observe.  With the current API this divides things neatly into status reports/tool finder API, and everything else.  For simplicity, the
status report GET and tool minder API should be public, and everything else behind auth.  This obviates the need for actually having multiple user types, while still allowing there to be people who can see the tool only (those who are unauthenticated) And people who can do anything (authenticated users)

### Notes on Permissions
 * No elaborate permission system
 * Non-authenticated users still have some limited access to FabMo - they can at least see the login page!  Also status reports, tool minder API, etc.
 * App-level permissions (What apps have permission to do) is a separate topic, outside the scope of this document

### Open Questions about Permissions
 * Is there a notion of "special permissions" (distinguishing users who can connect and drive the tool only from users who can create and destroy other users, etc)
 * If you're not logged in, you don't get access to the dashboard *at all* - is this too restrictive?
 * Do non-authenticated users get access to more than just the status and tool minder API endpoints?

## Login
When the user visits the tool root URL, if they are not authenticated, they are directed to a login page.  If they have a valid login, they may enter it, and are awarded access to the tool if and only if nobody is logged in (or in the case that there *are* multiple user types, no other *operators* are logged in)  In the event that someone else is logged in, they get a bounce, saying that only one person can use the tool at once.

### Notes on Login
 * Only one user per tool at a time (unless there are multiple types of users, and there could harmlessly be multiple logins from a lesser user-type)
 * Login page gates all access to the dashboard
 * Login from cloud accounts might be supported through *account linking* as described above
 * Same user can be logged in from multiple devices

### Open Questions on Login
 * Can an incoming user bump a user already using the tool?
 * Does what the user currently logged in is doing have any impact on their "bumpability" (ie do they have a running job, are they actively using apps, etc)
