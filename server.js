// Socket.IO 모듈 로드
var io = require('socket.io').listen(3000);
var mysql = require('mysql');

// 클라이언트와 관리자 접속자 정보를 담아둘 배열
var client_list = [];
var admin_list = [];

const ADMIN = 1;
const CLIENT = 2;

var connection = mysql.createConnection({
	host	: '127.0.0.1',
    port 	: 3306,
    user 	: 'nev8876',
    password : 'naver8876',
    database :'db_1000syb',
    charset : 'utf8mb4'
});


connection.connect(function(err) {
    if (err) {
        console.error('mysql connection error');
        console.error(err);
        throw err;
    }
});


// 로그 삽입용 쿼리 생성
function make_query ( ctl_utype, ctl_ip, ctl_session_id, ctl_nickname, ctl_type, ctl_desc )
{
    var ret = " INSERT INTO tbl_chatlog SET ";
        ret += " `ctl_utype` = '" + (ctl_utype == ADMIN ? "ADMIN" : "CLIENT") + "', ";
        ret += " `ctl_ip` = " + connection.escape(ctl_ip) + ", ";
        ret += " `ctl_session_id` = '" + ctl_session_id + "', ";
        ret += " `ctl_nickname` = " + connection.escape(ctl_nickname) + ", ";
        ret += " `ctl_type` = '" + ctl_type + "', ";
        ret += " `ctl_desc` = " + connection.escape(ctl_desc) + ", ";
        ret += " `ctl_regtime` = NOW()";

    return ret;
}

// 일주일 전의 채팅기록은 삭제합니다. (12시간마다 실행합니다.)
setInterval(function() {
    var qry = "DELETE FROM tbl_chatlog WHERE ctl_regtime < DATE_ADD(NOW(), INTERVAL -7 day)";
    connection.query(qry);
}, 1000 * 60 * 60 * 12 );

// 소켓 접속
io.sockets.on('connection', function(socket) {

    // 룸 이름은 wnfair로 설정한다.
    socket.room = "wnfair";

    // 사용자 접속시 실행
    socket.on('systemIn', function(data) {

        // 필수정보가 포함되지 않을경우 리턴한다.
        if( ! data.nickname || ! data.utype || ! data.session_id ) return false;

        // 소켓에 정보를 추가한다.
        socket.nickname = data.nickname;
        socket.utype    = data.utype;
        socket.session_id = data.session_id;
        socket.ip       = data.ip;
        socket.is_mobile = data.is_mobile;

        // 목록에 추가할 객체 생성
        var obj = {
            socket_id : socket.id,
            nickname : socket.nickname,
            utype : socket.utype,
            session_id : socket.session_id,
            is_mobile : socket.is_mobile,
            ip : socket.ip,
            is_alive : true
        };

        // 관리자로 접속한경우
        if( obj.utype == ADMIN ) {
            admin_list.push( obj );
            io.sockets.emit( 'admin_connect', obj );         
        }
        else if (obj.utype == CLIENT) {

            // 현재 클라이언트 목록중에 같은세션을 가지고 있는사람이 있는가?
            for(var k in client_list) {
                if( client_list[k].session_id == obj.session_id ) {
                    obj.nickname = client_list[k].nickname;
                    socket.nickname = client_list[k].nickname;
                    socket.emit('rename_nickname', client_list[k].nickname);
                }
            }
            client_list.push( obj );
            io.sockets.emit( 'client_connect', obj );
        }

        // 현재 소켓을 Room에 참가시킨다.
        socket.join(socket.room);

        // MYSQL에 접속정보를 저장한다.
        //connection.query( make_query( socket.utype, socket.ip, socket.session_id, socket.nickname, "CONNECT", "" ) );
    });

    // 사용자 접속해제시 실행한다.
    socket.on('disconnect', function(){
        // 필수정보가 없다면 리턴
        if(!socket.utype || !socket.session_id )  return false;

        // 사용자 구분에 따라서 목록에서 삭제
        if( socket.utype == ADMIN ) {
            for( var i in admin_list ) {
                if( admin_list[i].socket_id == socket.id ) {
                    //delete admin_list[i];
                    admin_list.splice(i, 1);
                    for(var k in client_list) {
                        io.to( client_list[k].socket_id ).emit('admin_disconnect', admin_list[i]);
                    }
                }
            }
        }
        else if (socket.utype == CLIENT) {
            for( var i in client_list ) {
                if( client_list[i].socket_id == socket.id ) {
                    for(var k in admin_list) {
                        io.to( admin_list[k].socket_id ).emit('client_disconnect', client_list[i]);
                    }
                    //delete client_list[i];
                    client_list.splice(i, 1);
                }
            }
        }
        //connection.query( make_query( socket.utype, socket.ip, socket.session_id, socket.nickname, "DISCONNECT", "" ) );
    });

    // 사용자 목록 요청
    socket.on('get_client_list', function() {
        socket.emit('get_client_list', client_list);
    });

    // 관리자 목록 요청
    socket.on('get_admin_list', function() {
        socket.emit('get_admin_list', admin_list);
    });
    
    // 채팅 메시지
    socket.on('chat_message', function( data ) {
        data.socket_id = socket.id;
        data.ip =  typeof data.ip != 'undefined' ? data.ip : socket.ip;
        data.session_id = socket.session_id;
        data.nickname = typeof data.ip != 'undefined' ? data.nickname : socket.nickname;
        data.utype = typeof data.utype != 'undefined' ? data.utype : socket.utype;

        if( typeof data.type != 'undefined' && data.type == "ALL") {

            var session_ids = [];
            for (var i in client_list) {
                data.target_session = client_list[i].session_id;
                session_ids.push(client_list[i].session_id);
                io.to( client_list[i].socket_id ).emit('message', data);                
                connection.query( make_query( socket.utype, socket.ip, data.target_session, socket.nickname, "MESSAGE", data.message ) );
            }

            for (var i in admin_list ) {
                for (var k in session_ids) {
                    data.target_session = session_ids[k];
                    io.to( admin_list[i].socket_id ).emit('message', data);
                }
            }
        }
        else {
            // 관리자 전체에게 메시지를 보낸다.
            for (var i in admin_list) {
                io.to( admin_list[i].socket_id ).emit('message', data);
            }

            if( socket.utype == CLIENT ) {
                data.target_session = socket.session_id;
            }

            // 메시지 타겟 ID에게 발송
            // 해당세션과 동일한 세션에 전부 발송
            for (var i in client_list) {
                if( client_list[i].session_id == data.target_session ) {
                    io.to( client_list[i].socket_id ).emit('message', data);
                }
            }
            
            connection.query( make_query( socket.utype, socket.ip, data.target_session, socket.nickname, "MESSAGE", data.message ) );
            
        }
    });
});
