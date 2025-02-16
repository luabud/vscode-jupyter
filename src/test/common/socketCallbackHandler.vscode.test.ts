/* eslint-disable @typescript-eslint/no-explicit-any, max-classes-per-file, , , @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, no-empty,@typescript-eslint/no-empty-function */

import { expect } from 'chai';
import * as getFreePort from 'get-port';
import * as net from 'net';
import { SocketCallbackHandler } from '../../platform/common/net/socket/socketCallbackHandler';
import { SocketServer } from '../../platform/common/net/socket/socketServer';
import { SocketStream } from '../../platform/common/net/socket/SocketStream';
import { createDeferred, Deferred } from '../../platform/common/utils/async';

const uint64be = require('uint64be');

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class Commands {
    public static ExitCommandBytes: Buffer = new Buffer('exit');
    public static PingBytes: Buffer = new Buffer('ping');
}

namespace ResponseCommands {
    export const Pong = 'PONG';
    export const ListKernels = 'LSTK';
    export const Error = 'EROR';
}

const GUID = 'This is the Guid';
const PID = 1234;

class MockSocketCallbackHandler extends SocketCallbackHandler {
    private pid?: number;
    private guid?: string;
    constructor(socketServer: SocketServer) {
        super(socketServer);
        this.registerCommandHandler(ResponseCommands.Pong, this.onPong.bind(this));
        this.registerCommandHandler(ResponseCommands.Error, this.onError.bind(this));
    }
    public ping(message: string) {
        this.SendRawCommand(Commands.PingBytes);

        const stringBuffer = new Buffer(message);
        const buffer = Buffer.concat([
            Buffer.concat([new Buffer('U'), uint64be.encode(stringBuffer.byteLength)]),
            stringBuffer
        ]);
        this.stream.Write(buffer);
    }
    protected handleHandshake(): boolean {
        if (!this.guid) {
            this.guid = this.stream.readStringInTransaction();
            if (typeof this.guid !== 'string') {
                return false;
            }
        }

        if (!this.pid) {
            this.pid = this.stream.readInt32InTransaction();
            if (typeof this.pid !== 'number') {
                return false;
            }
        }

        if (this.guid !== GUID) {
            this.emit('error', this.guid, GUID, 'Guids not the same');
            return true;
        }
        if (this.pid !== PID) {
            this.emit('error', this.pid, PID, 'pids not the same');
            return true;
        }

        this.emit('handshake');
        return true;
    }
    private onError() {
        const message = this.stream.readStringInTransaction();
        if (typeof message !== 'string') {
            return;
        }
        this.emit('error', '', '', message);
    }
    private onPong() {
        const message = this.stream.readStringInTransaction();
        if (typeof message !== 'string') {
            return;
        }
        this.emit('pong', message);
    }
}
class MockSocketClient {
    private socket?: net.Socket;
    private socketStream?: SocketStream;
    private def?: Deferred<any>;
    constructor(private port: number) {}
    public get SocketStream(): SocketStream {
        if (this.socketStream === undefined) {
            throw Error('not listening');
        }
        return this.socketStream;
    }
    public start(): Promise<any> {
        this.def = createDeferred<any>();
        this.socket = net.connect(this.port as any, this.connectionListener.bind(this));
        return this.def.promise;
    }
    private connectionListener() {
        if (this.socket === undefined || this.def === undefined) {
            throw Error('not started');
        }
        this.socketStream = new SocketStream(this.socket, new Buffer(''));
        this.def.resolve();
        this.socket.on('error', () => {});
        this.socket.on('data', (data: Buffer) => {
            try {
                this.SocketStream.Append(data);
                // We can only receive ping messages
                this.SocketStream.BeginTransaction();
                const cmdIdBytes: number[] = [];
                for (let counter = 0; counter < 4; counter += 1) {
                    const byte = this.SocketStream.ReadByte();
                    if (typeof byte !== 'number') {
                        this.SocketStream.RollBackTransaction();
                        return;
                    }
                    cmdIdBytes.push(byte);
                }
                const cmdId = new Buffer(cmdIdBytes).toString();
                const message = this.SocketStream.ReadString();
                if (typeof message !== 'string') {
                    this.SocketStream.RollBackTransaction();
                    return;
                }

                this.SocketStream.EndTransaction();

                if (cmdId !== 'ping') {
                    this.SocketStream.Write(new Buffer(ResponseCommands.Error));

                    const errorMessage = `Received unknown command '${cmdId}'`;
                    const errorBuffer = Buffer.concat([
                        Buffer.concat([new Buffer('A'), uint64be.encode(errorMessage.length)]),
                        new Buffer(errorMessage)
                    ]);
                    this.SocketStream.Write(errorBuffer);
                    return;
                }

                this.SocketStream.Write(new Buffer(ResponseCommands.Pong));

                const messageBuffer = new Buffer(message);
                const pongBuffer = Buffer.concat([
                    Buffer.concat([new Buffer('U'), uint64be.encode(messageBuffer.byteLength)]),
                    messageBuffer
                ]);
                this.SocketStream.Write(pongBuffer);
            } catch (ex) {
                this.SocketStream.Write(new Buffer(ResponseCommands.Error));

                const errorMessage = `Fatal error in handling data at socket client. Error: ${ex.message}`;
                const errorBuffer = Buffer.concat([
                    Buffer.concat([new Buffer('A'), uint64be.encode(errorMessage.length)]),
                    new Buffer(errorMessage)
                ]);
                this.SocketStream.Write(errorBuffer);
            }
        });
    }
}

// Defines a Mocha test suite to group tests of similar kind together
suite('SocketCallbackHandler', () => {
    let socketServer: SocketServer;
    setup(() => (socketServer = new SocketServer()));
    teardown(() => socketServer.Stop());

    test('Succesfully starts without any specific host or port', async () => {
        const port = await socketServer.Start();
        expect(port).to.be.greaterThan(0);
    });
    test('Succesfully starts with port=0 and no host', async () => {
        const port = await socketServer.Start({ port: 0 });
        expect(port).to.be.greaterThan(0);
    });
    test('Succesfully starts with port=0 and host=localhost', async () => {
        const port = await socketServer.Start({ port: 0, host: 'localhost' });
        expect(port).to.be.greaterThan(0);
    });
    test('Succesfully starts with host=127.0.0.1', async () => {
        const port = await socketServer.Start({ host: '127.0.0.1' });
        expect(port).to.be.greaterThan(0);
    });
    test('Succesfully starts with port=0 and host=127.0.0.1', async () => {
        const port = await socketServer.Start({ port: 0, host: '127.0.0.1' });
        expect(port).to.be.greaterThan(0);
    });
    test('Succesfully starts with specific port', async () => {
        const availablePort = await getFreePort({ host: 'localhost' });
        const port = await socketServer.Start({ port: availablePort, host: 'localhost' });
        expect(port).to.be.equal(availablePort);
    });
    test('Succesful Handshake', async () => {
        const port = await socketServer.Start();
        const callbackHandler = new MockSocketCallbackHandler(socketServer);
        const socketClient = new MockSocketClient(port);
        await socketClient.start();
        const def = createDeferred<any>();

        callbackHandler.on('handshake', () => {
            def.resolve();
        });
        callbackHandler.on('error', (actual: string, expected: string, message: string) => {
            if (!def.completed) {
                def.reject({ actual: actual, expected: expected, message: message });
            }
        });

        // Client has connected, now send information to the callback handler via sockets
        const guidBuffer = Buffer.concat([new Buffer('A'), uint64be.encode(GUID.length), new Buffer(GUID)]);
        socketClient.SocketStream.Write(guidBuffer);
        socketClient.SocketStream.WriteInt32(PID);
        await def.promise;
    });
    test('Unsuccesful Handshake', async () => {
        const port = await socketServer.Start();
        const callbackHandler = new MockSocketCallbackHandler(socketServer);
        const socketClient = new MockSocketClient(port);
        await socketClient.start();

        const def = createDeferred<any>();
        let timeOut: NodeJS.Timer | undefined | number = setTimeout(() => {
            def.reject('Handshake not completed in allocated time');
        }, 5000);

        callbackHandler.on('handshake', () => {
            if (timeOut) {
                clearTimeout(timeOut as any);
                timeOut = undefined;
            }
            def.reject('handshake should fail, but it succeeded!');
        });
        callbackHandler.on('error', (actual: string | number, expected: string, message: string) => {
            if (timeOut) {
                clearTimeout(timeOut as any);
                timeOut = undefined;
            }
            if (actual === 0 && message === 'pids not the same') {
                def.resolve();
            } else {
                def.reject({ actual: actual, expected: expected, message: message });
            }
        });

        // Client has connected, now send information to the callback handler via sockets
        const guidBuffer = Buffer.concat([new Buffer('A'), uint64be.encode(GUID.length), new Buffer(GUID)]);
        socketClient.SocketStream.Write(guidBuffer);

        // Send the wrong pid
        socketClient.SocketStream.WriteInt32(0);
        await def.promise;
    });
    test('Ping with message', async () => {
        const port = await socketServer.Start();
        const callbackHandler = new MockSocketCallbackHandler(socketServer);
        const socketClient = new MockSocketClient(port);
        await socketClient.start();

        const def = createDeferred<any>();
        const PING_MESSAGE = 'This is the Ping Message - Функция проверки ИНН и КПП - 说明';

        callbackHandler.on('handshake', () => {
            // Send a custom message (only after handshake has been done)
            callbackHandler.ping(PING_MESSAGE);
        });
        callbackHandler.on('pong', (message: string) => {
            try {
                expect(message).to.be.equal(PING_MESSAGE);
                def.resolve();
            } catch (ex) {
                def.reject(ex);
            }
        });
        callbackHandler.on('error', (actual: string, expected: string, message: string) => {
            if (!def.completed) {
                def.reject({ actual: actual, expected: expected, message: message });
            }
        });

        // Client has connected, now send information to the callback handler via sockets
        const guidBuffer = Buffer.concat([new Buffer('A'), uint64be.encode(GUID.length), new Buffer(GUID)]);
        socketClient.SocketStream.Write(guidBuffer);

        // Send the wrong pid
        socketClient.SocketStream.WriteInt32(PID);
        await def.promise;
    });
    test('Succesful Handshake with port=0 and host=localhost', async () => {
        const port = await socketServer.Start({ port: 0, host: 'localhost' });
        const callbackHandler = new MockSocketCallbackHandler(socketServer);
        const socketClient = new MockSocketClient(port);
        await socketClient.start();

        const def = createDeferred<any>();

        callbackHandler.on('handshake', () => def.resolve());
        callbackHandler.on('error', (actual: string, expected: string, message: string) => {
            if (!def.completed) {
                def.reject({ actual: actual, expected: expected, message: message });
            }
        });

        // Client has connected, now send information to the callback handler via sockets
        const guidBuffer = Buffer.concat([new Buffer('A'), uint64be.encode(GUID.length), new Buffer(GUID)]);
        socketClient.SocketStream.Write(guidBuffer);
        socketClient.SocketStream.WriteInt32(PID);
        await def.promise;
    });
    test('Succesful Handshake with specific port', async () => {
        const availablePort = await new Promise<number>((resolve, reject) =>
            getFreePort({ host: 'localhost' }).then(resolve, reject)
        );
        const port = await socketServer.Start({ port: availablePort, host: 'localhost' });

        expect(port).to.be.equal(availablePort, 'Server is not listening on the provided port number');
        const callbackHandler = new MockSocketCallbackHandler(socketServer);
        const socketClient = new MockSocketClient(port);
        await socketClient.start();

        const def = createDeferred<any>();

        callbackHandler.on('handshake', () => def.resolve());
        callbackHandler.on('error', (actual: string, expected: string, message: string) => {
            if (!def.completed) {
                def.reject({ actual: actual, expected: expected, message: message });
            }
        });

        // Client has connected, now send information to the callback handler via sockets
        const guidBuffer = Buffer.concat([new Buffer('A'), uint64be.encode(GUID.length), new Buffer(GUID)]);
        socketClient.SocketStream.Write(guidBuffer);
        socketClient.SocketStream.WriteInt32(PID);
        await def.promise;
    });
});
