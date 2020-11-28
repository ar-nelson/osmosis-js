const zmq = require('zeromq');

(async () => {
  console.log('Connecting to hello world server...');
  const requester = new zmq.Push();

  let x = 0;
  requester.on('message', (reply) => {
    console.log('Received reply', x, ': [', reply.toString(), ']');
    x += 1;
    if (x === 10) {
      requester.close();
      process.exit(0);
    }
  });

  requester.connect('tcp://localhost:5555');

  for (var i = 0; i < 10; i++) {
    console.log('Sending request', i, '...');
    requester.send('Hello');
  }

  process.on('SIGINT', () => {
    requester.close();
  });
})();
