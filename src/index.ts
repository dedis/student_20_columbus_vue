import { Roster, WebSocketAdapter } from '@dedis/cothority/network';
import { GetUpdateChain } from '@dedis/cothority/skipchain/proto';
import { SkipBlock } from '@dedis/cothority/skipchain';
import { WebSocketConnection } from '@dedis/cothority/network/connection';
import { ByzCoinRPC } from '@dedis/cothority/byzcoin';
import { PaginateResponse, PaginateRequest } from '@dedis/cothority/byzcoin/proto/stream';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

var roster : Roster;
var ws: WebSocketAdapter;
const firstBlockID  = "9cc36071ccb902a1de7e0d21a2c176d73894b1cf88ae4cc2ba4c95cd76f474f3";
const pageSize = 1
const numPages = 2
const logEach = 1
const printDetails: boolean = false
const subject = new Subject<number>();
var lastBlock:SkipBlock

export function sayHi(){
  roster = Roster.fromTOML(rosterStr);
  if(!roster){
    console.log("Roster is undefined")
    return;
  }
  document
    .getElementById("load-button")
    .addEventListener("click", (e:Event)=> {

      if (ws != undefined) {
        ws.close(1000, "new load");
        ws = undefined;
      }
      const notifier = new Subject();
      var pageDone = 0;
      subject.pipe(takeUntil(notifier)).subscribe({
        next: (i: number) => {
          console.log(i)
          if (i == pageSize) {
            pageDone++;
            if (pageDone == numPages) {
              notifier.next();
              notifier.complete();
            }
          }
        }
      });

      var dataB = getData();
    })
}


function getData(){
  var bid: Buffer;
  var backward:boolean = false
  try {
    bid = hex2Bytes(firstBlockID);
  } catch (error) {
    console.log("failed to parse the block ID: ", error);
    return;
  }

  try {
    var conn = new WebSocketConnection(
      roster.list[0].getWebSocketAddress(),
      ByzCoinRPC.serviceName
    );
  } catch (error) {
    console.log("error creating conn: ", error);
    return;
  }
  if (ws === undefined) {
    var count = 0;

    conn.sendStream<PaginateResponse>(
      new PaginateRequest({
        startid: bid,
        pagesize: pageSize,
        numpages: numPages,
        backward: backward
      }),
      PaginateResponse).subscribe({
      // ws callback "onMessage":
        next: ([data, localws]) => {
          if (data.errorcode != 0) {
            console.log(
              `got an error with code ${data.errorcode} : ${data.errortext}`
            );
            return;
          }
          if( localws !== undefined) {
            ws = localws
          }
          var runCount = 0;
          for (var i = 0; i < data.blocks.length; i++) {
            runCount++;
            if (data.backward) {
              count--;
            } else {
              count++;
            }
            if (count % logEach == 0) {
              subject.next(runCount);
              if (printDetails) {
                  console.log(data.blocks[i])
                  //longBlockString(data.blocks[i], count, data.pagenumber)

              } else {
                console.log(data.blocks[i])
                //shortBlockString(data.blocks[i], count, data.pagenumber)
              }
            }
          }
          lastBlock = data.blocks[data.blocks.length - 1];
        },
        complete: () => {
          console.log("closed");
        },
        error: (err: Error) => {
          console.log("error: ", err);
          ws = undefined;
        }
      });
  } else {
    const message = new PaginateRequest({
      startid: bid,
      pagesize: pageSize,
      numpages: numPages,
      backward: backward
    });
    const messageByte = Buffer.from(message.$type.encode(message).finish());
    ws.send(messageByte);
  }

  return 0
}






function hex2Bytes(hex: string) {
  if (!hex) {
    return Buffer.allocUnsafe(0);
  }

  return Buffer.from(hex, "hex");
}

const rosterStr = `[[servers]]
Address = "tls://127.0.0.1:7770"
Suite = "Ed25519"
Public = "581255c918bf71d14d20c0e1525c293e7fd0bcca792b8662352a8742ab4920fc"
Description = "cothority_local"
[servers.Services]
  [servers.Services.ByzCoin]
    Public = "27a562854d68d55f62baa42497075cad283cf87facb0ca73034ac4b50a6140e93af4049d827d82d3538b54d3f175fb40bec78a679f396a9f479b7fc3c475ff9604ce524cc6beb00b013f4b71f9b1786148189df9ad83dddb03bd5a40d928aa0405e77d07d31212c37ee026d824fc385642b61b29120eba6d200a42eab2ae5723"
    Suite = "bn256.adapter"
  [servers.Services.Skipchain]
    Public = "58f3e2bbaf4ca4a847ae98e46af5095182b4e1e63b08aabac97729735d2ca9126d0da098092cf84ddf08ce0a292142bde948deddaf00b56ec64668539ea6cf301373f5a7ec95af7b881595dbb277f4520f5a18c8da8806b52d489dce7a137cc966eafdcf145f16ccd589f1957f93fec40bd20504a038cfa8e2b3117e992597fa"
    Suite = "bn256.adapter"`;
