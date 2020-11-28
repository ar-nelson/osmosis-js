const zmq = require('zeromq');

(async () => {
  const responder = new zmq.Reply();

  await responder.bind('tcp://*:5555');
  console.log('Listening on 5555...');

  process.on('SIGINT', () => {
    responder.close();
  });

  for await (const [request] of responder) {
    console.log('Received request: [', request.toString(), ']');

    // do some 'work'
    setTimeout(() => {
      // send reply back to client.
      responder.send('World');
    }, 1000);
  }
})();
