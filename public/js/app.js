


// the norm is not yet fully normalized, this is temporary, TODO update
var RTCPeerConnection = window.PeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection; 
navigator.getUserMedia = navigator.getUserMedia || navigator.mozGetUserMedia || navigator.webkitGetUserMedia;



// the socket handles sending messages between peer connections while they are in the
// process of connecting
var socket = new WebSocket('ws://' + window.location.host + window.location.pathname);
console.log('socket param: ' + 'ws://' + window.location.host + window.location.pathname);


socket.onopen = function() {
    sessionReady = true;
};

socket.onmessage = function(message) {
    var msg = JSON.parse(message.data);

    switch(msg.type) {
        case 'assigned_id':
            socket.id = msg.id;
            console.log('socket id attributed = ' + socket.id);
            break;

        case 'peer_available':
            console.log('Peer is available, now trying to connect to him with RTCPeerConnection');
            startWhenReady();
            break;

        case 'received_offer': 
            console.log('received offer', msg.data);
            pc.setRemoteDescription(new RTCSessionDescription(msg.data));
            pc.createAnswer(function(description) {
                console.log('sending answer');
                pc.setLocalDescription(description); 
                socket.send(JSON.stringify({
                    type: 'received_answer', 
                    data: description
                }));
            }, null, mediaConstraints);
            break;

        case 'received_answer':
            console.log('received answer');
            if(!connected) {
                pc.setRemoteDescription(new RTCSessionDescription(msg.data));
                connected = true;
                button.hidden = false;
                socket.send(JSON.stringify({
                    type: 'connection_ok'
                }));
            }
            break;

        case 'received_candidate':
            console.log('received candidate');
            var candidate = new RTCIceCandidate({
                sdpMLineIndex: msg.data.label,
                candidate: msg.data.candidate
            });
            pc.addIceCandidate(candidate);
            break;

        case 'connection_ok':
            connected = true;
            button.hidden = false;
            console.log('DEBUG: connection_ok msg received');
            break;

        case 'nexted':
            console.log('You\'ve been nexted!');
            connected = false;
            button.hidden = true;
            vid2.hidden = true;

            restartPc();

            socket.send(JSON.stringify({
                type: 'next_ack'
            }));

            break;

        case 'nb_clients':
           
            nbClients = msg.data;

            break;

        case 'connection_closed':
            console.log('connection closed by peer');
            //alert('connection closed by peer');
            vid2.hidden = true;
            connected = false;
            button.hidden = true;

            restartPc();

            socket.send(JSON.stringify({
                type: 'remote_connection_closed'
            }));

            break;
    }
};




//////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////


var nbClients = 0;
var button;
var pc;
var configuration = {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]};
var stream;
var pc = new RTCPeerConnection(configuration);
var connected = false;
var sessionReady = false;
var mediaConstraints = {
    'mandatory': {
        'OfferToReceiveAudio':true, 
        'OfferToReceiveVideo':true
    }
};

function addListenersToPc() {
    pc.onicecandidate = function(e) {
        if(e.candidate) {
            socket.send(JSON.stringify({
                type: 'received_candidate',
                data: {
                    label: e.candidate.sdpMLineIndex,
                id: e.candidate.sdpMid,
                candidate: e.candidate.candidate
                }
            }));
        }
    };

    pc.onaddstream = function(e) {
        console.log('start remote video stream');
        vid2.src = window.URL.createObjectURL(e.stream);
        vid2.hidden = false;
        vid2.play();
    };
}
addListenersToPc();


function restartPc() {
    pc.close();
    pc = new RTCPeerConnection(configuration);                                  // FIXME : I'm not sure it's the best way to do this... But it works!
    pc.addStream(stream);
    addListenersToPc();
}



//////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////


function startWhenReady() {
    if (isReady()) 
        start();
    else 
        setTimeout('startWhenReady()', 500);
    
}

function isReady() {
    return stream && sessionReady;
}

function broadcast() {
    
    // gets local video stream and renders to vid1
    navigator.getUserMedia({audio: true, video: true}, function(s) {    // we continue on this function when the user has accepted the webcam
        stream = s;
        pc.addStream(s);
        vid1.src = window.URL.createObjectURL(s);
        vid1.play();

    }, function(e) {
        console.log('getUserMedia error: ' + e.name);
        alert('Error: ' + e.name);
        socket.send(JSON.stringify({
            type: 'close'
        }));
    });
}


function start() {
    // this initializes the peer connection
    console.log('Creating offer for peer');
    pc.createOffer(function(description) {
        pc.setLocalDescription(description);
        socket.send(JSON.stringify({
            type: 'received_offer',
            data: description
        }));
    }, null, mediaConstraints);
}

function next() {
    if (!connected) {
        console.log('Error: you can\'t next someone if you\'re not connected!');            // sanity check
        return;
    }

    console.log('Nexting this peer');
    connected = false;
    button.hidden = true;
    vid2.hidden = true;

    socket.send(JSON.stringify({
        type: 'next'
    }));

    restartPc();
}

window.onload = function() {

    button = document.getElementById("nextButton");
    button.hidden = true;

    if(button.addEventListener){
        button.addEventListener("click", function() { next();});
    } else {
        button.attachEvent("click", function() { next();});
    };

    broadcast();
};

window.onbeforeunload = function() {
    socket.send(JSON.stringify({
        type: 'close'
    }));
    pc.close();
    pc = null;
};


