Game Objective: To teach anyone couching tactics, strategies, and techniques (which are essential management skills other then player's talent).

Features and functionality:
1) Game should be played like chess turns where user forms team's position and in return couch will scan the user's position and opponent possition, and give critical feedback and possible opponent tactics, strategies, and techniques (with directional animated arrows).
2) Players moving positions are deterministic (but very precious numbers of positions) and not free hand like currently it is, save opponent's player position and user player position in database (docker postgres) for couch analysis and critical feed back.
3) Game starts like a chess where opponent position is based on fixed options of strategies from which it picks randomly, same for user as well.
4) Players move should be realistic and not like jumping from one corner of the board to another.
5) There should be a board of score being maintained for user's total good and bad and overall decision along with turns taken.
6) Couch should response in json with 2 different feedback, first is short and simple to understand (which will be displayed to the user and chat), and when user should click on detailed version of that feedback then system should display the second feedback which is a bit technical and well reasoned.
7) Apply all the real football rules into this game, remember the goal is to teach user how to become a football strategist.


Important Note:
Use existing tech and libraries used and use docker postgres for persistent database and couch feedback analysis.