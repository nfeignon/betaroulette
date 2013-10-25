

var express = require('express');
var app = express();
var ws = require('websocket.io');
var uuid = require('node-uuid');

app.use(express["static"]('./public'));

app.get('/', function(req, res) {
    return res.render('index.jade', {
        params: req.query
    });
});

var server = app.listen(3002);
var io = ws.attach(server);


io.clientsWaiting || (io.clientsWaiting = []);
io.clientsInRooms || (io.clientsInRooms = 0);


function isPeerAvailable(sock) {
    if (io.clientsWaiting.length > 1) {
        sock.send(JSON.stringify({
            type: 'peer_available'
        }));
    }
}


io.on('connection', function(socket) {
    console.log('------------------------------------------------');
    console.log('Client connected from ' + socket.req.connection.remoteAddress);
    console.log('User Agent: ' + socket.req.headers['user-agent'] + '\n');

    var base; 

    socket.id = uuid.v1();
    console.log('attributed id = ' + socket.id);
    
    io.clientsWaiting.push(socket);

    socket.send(JSON.stringify({
        type: 'assigned_id',
        id: socket.id
    }));

    isPeerAvailable(socket);              // send msg of type 'peer_available' if someone is available to chat

    console.log('new client connected :  clientsWaiting size = ' + io.clientsWaiting.length);

    var destSock;

    return socket.on('message', function(data) {
        var msg, sock, i, ref;
        msg = JSON.parse(data);

        console.log('recu un message de type ' + msg.type);

        ref = io.clientsWaiting;

        switch (msg.type) {
            case 'received_offer':
            case 'received_candidate':
            case 'received_answer':

                var messageSent = false;

                if (ref.length > 1) {

                    // if we don't have a destination socket
                    if (destSock == null) {
                        for (i = 0; i < ref.length; i++) {
                            if (ref[i].id !== socket.id) {
                                destSock = ref[i];
                                break;
                            }
                        }
                        if (destSock == null)           // if we didn't found a partner to chat with, it should not happen
                            console.log('partner not found, error !!!');
                    }
                } else {
                    if (destSock == null)
                        console.log('No one to chat with !');
                }

                if (destSock != null) {
                    //console.log('Me, ' + socket.id + ' am sending a msg ' + msg.type + ' to ' + destSock.id);
                    destSock.send(JSON.stringify(msg));
                }

                break;
            
            case 'connection_ok':
                var toDelete = [];
                for (i = 0; i < ref.length ; i++)
                    if (ref[i].id === socket.id || ref[i].id === destSock.id)
                        toDelete.push(ref[i]);

                for (i = 0; i < toDelete.length; i++)
                    ref.splice(ref.indexOf(toDelete[i]), 1);

                io.clientsInRooms += 2;

                console.log('CONNECTION OK, now ' + ref.length + ' clients waiting, ' + io.clientsInRooms + ' clients in communication.');
                printId(ref);
                break;

            case 'remote_connection_closed':
                destSock = null;
                isPeerAvailable(socket);
                break;

            case 'close':

                console.log('Client deconnecté ! id: ' + socket.id);

                //printId(ref);

                var pos = ref.indexOf(socket);
                if (pos >= 0)
                    ref.splice(pos, 1);     // remove socket of disconnected client, if it exists

                io.clientsInRooms -= 2;

                if (destSock != null) {
                    ref.push(destSock);                     // add socket of his partner to the waiting list
                    destSock.send(JSON.stringify({        // tell that peer is disconnected
                        type: 'connection_closed' 
                    }));
                }

                printId(ref);

                socket.close();

                break;
        }
    });
});

function printId(ref) {
    console.log('-------------------------');
    console.log(io.clientsInRooms + ' clients in communication!');
    console.log('Printing socket ID of all sockets in the waiting list');

    var i;
    for (i = 0; i < ref.length; i++) {
        if (ref[i] != null)
            console.log(ref[i].id);
    }

    console.log('-------------------------');

}

