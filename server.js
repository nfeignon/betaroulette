
var uuid = require('node-uuid')
, ent = require('ent')
, geoip = require('geoip-lite')
, winston = require('winston')
, WebSocketServer = require('ws').Server
, http = require('http')
, express = require('express')
, app = express()
, port = process.env.PORT || 3002;
 
app.use(express.static(__dirname + '/public'));

var logger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({'timestamp':function() {return new Date().getHours() + ':' + new Date().getMinutes(); }, 'colorize':true, 'level':'info'}),
        new (winston.transports.File)({ filename: 'log', 'timestamp':true, 'level':'verbose'})
    ]
});
 
var server = http.createServer(app);
server.listen(port);
 
var wss = new WebSocketServer({server: server});

logger.info('Server listening on port ' + port);

wss.clientsWaiting || (wss.clientsWaiting = []);
wss.clientsInRooms || (wss.clientsInRooms = 0);



wss.on('connection', function(socket) {
    console.log('------------------------------------------------');
    var ip = socket.upgradeReq.connection.remoteAddress;
    var location = geoip.lookup(ip);

    if (location)
        socket.location = location['city'] + ', ' + location['country'];
    else
        socket.location = 'unknown';

    logger.info('Client "' + ip + '" ' + 'connected'.green +  ' from "' + socket.location + '"');
    logger.info('User Agent: ' + socket.upgradeReq.headers['user-agent'] + '\n');

    var base;

    socket.id = uuid.v1();
    logger.info('attributed id: ' + socket.id);

    socket.connected = false;
    socket.isReady = false;
    socket.keepAlive = false;
    socket.lastKeepAlive = 0;       // gets new time when connection ready received or when keep_alive received

    socket.destSock = null;

    socket.send(JSON.stringify({
        type: 'assigned_id',
        id: socket.id
    }));

    printId();

    socket.on('message', function(data) {
        var msg, sock, i, ref;
        msg = JSON.parse(data);

        logger.verbose('Received msg of type ' + msg.type + ' from ' + socket.id);

        ref = wss.clientsWaiting;

        switch (msg.type) {
            case 'received_offer':
            case 'received_candidate':
            case 'received_answer':

                if (socket.isReady) {

                    if (ref.length > 1) {

                        // if we don't have a destination socket
                        //
                        if (socket.destSock == null) {
                            for (i = 0; i < ref.length; i++) {
                                if (ref[i].id !== socket.id) {
                                    socket.destSock = ref[i];
                                    break;
                                }
                            }
                            if (socket.destSock == null)           // if we didn't found a partner to chat with, it should not happen
                                logger.error('partner not found, error !!!');
                        }

                    } else {
                        if (socket.destSock == null) {
                            logger.error('ERROR: received answer but no one is available for chat\nand remote socket doesn\'t exist...');
                        }
                    }


                    if (socket.destSock != null) {
                        logger.silly('Me, ' + socket.id + ' am sending a msg ' + msg.type + ' to ' + socket.destSock.id);
                        try {
                            socket.destSock.send(JSON.stringify(msg));
                        } catch (err) {}
                    } else {
                        logger.error('ERROR: remote socket doesn\'t exist, message ' + msg.type + ' could not be relayed');
                    }


                } else {
                    logger.error('ERROR: received ' + msg.type + ' but client was not ready!');
                }


                break;

            case 'client_ready':

                logger.info('Client with id ' + socket.id + ' ready!');
                socket.isReady = true;
                socket.keepAlive = true;
                socket.lastKeepAlive = new Date().getTime();
                checkKeepAlive(socket);

                wss.clientsWaiting.push(socket);

                printId();

                isPeerAvailable(socket);              // send msg of type 'peer_available' if someone is available to chat

                break;

            case 'connection_ok':

                if (socket.destSock == null) {
                    logger.error('ERROR: remote socket doesn\'t exist!');
                    return;
                }

                socket.destSock.send(JSON.stringify({
                    'type': 'connection_ok'
                }));

                var toDelete = [];
                for (i = 0; i < ref.length ; i++)
                    if (ref[i].id === socket.id || ref[i].id === socket.destSock.id)
                        toDelete.push(ref[i]);

                for (i = 0; i < toDelete.length; i++)
                    ref.splice(ref.indexOf(toDelete[i]), 1);

                wss.clientsInRooms += 2;

                socket.connected = true;
                socket.destSock.connected = true;

                socket.send(JSON.stringify({
                    'type': 'partner_location',
                    data: socket.destSock.location
                }));

                socket.destSock.send(JSON.stringify({
                    'type': 'partner_location',
                    data: socket.location
                }));

                logger.info('CONNECTION OK'.green.bold);
                printId();
                break;

            case 'next':
                if (socket.connected) {

                    var pos = ref.indexOf(socket);
                    if (pos >= 0) {
                        logger.error('ERROR: client\'s socket should not be in the waiting list');             // sanity check
                        return;
                    }

                    if (socket.destSock != null) {
                        var pos = ref.indexOf(socket.destSock);
                        if (pos >= 0) {
                            logger.error('ERROR: remote socket should not be in the waiting list');
                            return;
                        }
                    } else {
                        logger.error('ERROR: remote socket doesn\'t exist!');
                        return;
                    }

                    socket.destSock.send(JSON.stringify({        // tell peer that he has been nexted
                        type: 'nexted'
                    }));

                    wss.clientsInRooms -= 1;

                    socket.connected = false;
                    socket.destSock = null;

                } else {
                    logger.error('ERROR: next done but clients were not connected');
                }

                break;

            case 'next_ack':                 // sent from the client who has been nexted

                if (socket.connected) {
                    wss.clientsInRooms -= 1;

                    socket.connected = false;

                    ref.push(socket);
                    ref.push(socket.destSock);

                    socket.destSock = null;

                    isPeerAvailable(socket);

                    printId();
                } else {
                    logger.error('ERROR: next_ack done but clients were not connected');
                }

                break;

            case 'chat_msg':

                if (socket.connected) {
                    if (socket.destSock != null) {
                        escaped_msg = ent.encode(msg.data);                     // protection from XSS flaws
                        socket.destSock.send(JSON.stringify({
                                type: 'chat_msg',
                                data: escaped_msg
                        }));
                        logger.info('Forwarded message: ' + msg.data);
                    } else {
                        logger.error('Error while forwarding chat message, socket.destSock is null');
                    }
                } else {
                    logger.error('Error while forwarding chat message, socket not connected, message: ' + msg.data);
                }

                break;


            case 'keep_alive':
                socket.lastKeepAlive = new Date().getTime();
                break;

            case 'remote_connection_closed':

                ref.push(socket);                       // add socket to the waiting list
                wss.clientsInRooms -= 1;

                socket.connected = false;
                socket.destSock = null;

                printId();

                isPeerAvailable(socket);

                break;

            case 'close':

                logger.info('Client ' + 'disconnected'.red + '! id: ' + socket.id);

                socket.keepAlive = false;

                var pos = ref.indexOf(socket);
                if (pos >= 0)
                    ref.splice(pos, 1);     // remove socket of disconnected client, if it exists


                if (socket.destSock != null) {
                    if (socket.connected) {
                        wss.clientsInRooms -= 1;
                        try {
                            socket.destSock.send(JSON.stringify({        // tell that peer is disconnected
                                type: 'connection_closed'
                            }));
                        } catch (err) {}
                    } else {
                        logger.error('Error: close message, socket.destSock not null but socket not connected');
                    }

                    socket.destSock = null;
                }

                if (!socket.connected) {
                    socket.connected = false;
                    printId();
                }

                socket.close();

                break;
        }
    });
});

function isPeerAvailable(sock) {
    if (wss.clientsWaiting.length > 1) {
        sock.send(JSON.stringify({
            type: 'peer_available'
        }));
    } else {
        logger.info('isPeerAvailable(): ' + wss.clientsWaiting.length + ' in wait queue, aborting...');
    }
}

// TODO un intervalle serait peut etre mieux cf setInterval
function checkKeepAlive(socket) {
    if (socket.keepAlive) {
        timeDifference = new Date().getTime() - socket.lastKeepAlive;

        if (timeDifference > 6000) {     // 6 seconds
            logger.warn('Client with ID ' + socket.id + ' didn\'t send keep_alive packet for ' + timeDifference + ' ms.');
            logger.info('Client ' + 'disconnected'.red + '! id: ' + socket.id);

            ref = wss.clientsWaiting;

            socket.keepAlive = false;

            var pos = ref.indexOf(socket);
            if (pos >= 0)
                ref.splice(pos, 1);     // remove socket of disconnected client, if it exists


            if (socket.destSock != null) {
                if (socket.connected) {
                    wss.clientsInRooms -= 1;
                    try {
                        socket.destSock.send(JSON.stringify({        // tell that peer is disconnected
                            type: 'connection_closed'
                        }));
                    } catch (err) {}
                } else {
                    logger.error('Error: close message, socket.destSock not null but socket not connected');
                }

                socket.destSock = null;
            }

            if (!socket.connected) {
                socket.connected = false;
                printId();
            }

            socket.close();
        }

        setTimeout(function () {checkKeepAlive(socket)}, 3000);
    } else {
        logger.verbose('No more keepalive for socket with id ' + socket.id);
    }
}

function printId() {

    ref = wss.clientsWaiting;

    console.log('------------------------------------------------');
    logger.info(wss.clientsInRooms + ' clients in communication!');
    logger.info(ref.length + ' clients waiting!');
    logger.info('Printing socket ID of all sockets in the waiting list');

    var i;
    for (i = 0; i < ref.length; i++) {
        if (ref[i] != null)
            logger.info(ref[i].id + ' ' + ref[i].connected);
    }

    console.log('------------------------------------------------');

}


