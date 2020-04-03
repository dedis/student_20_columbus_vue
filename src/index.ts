import { Roster, WebSocketAdapter } from '@dedis/cothority/network';
import { GetUpdateChain } from '@dedis/cothority/skipchain/proto';
import { SkipBlock } from '@dedis/cothority/skipchain';
import { WebSocketConnection } from '@dedis/cothority/network/connection';
import { ByzCoinRPC } from '@dedis/cothority/byzcoin';
import { PaginateResponse, PaginateRequest } from '@dedis/cothority/byzcoin/proto/stream';
import { Subject } from 'rxjs';
import { takeUntil, last, first } from 'rxjs/operators';
import { DataBody } from '@dedis/cothority/byzcoin/proto';

var roster : Roster;
var ws: WebSocketAdapter;
var firstBlockID  = "9cc36071ccb902a1de7e0d21a2c176d73894b1cf88ae4cc2ba4c95cd76f474f3";
const pageSize = 1 //combien de blocks je veux
const numPages = 1 //nombre de requete pour faire du streaming: 50 blocks, en 5 requete asynchrone. 
const logEach = 1 //nombre de block total: pagesize * numpages
const subject = new Subject<[number, SkipBlock]>();
var lastBlock:SkipBlock
var contractID = ""
var blocks: string[] = []

export function sayHi(){
  console.log("*****************Say Hi*****************")

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
      var repeatCounter = 0;
      subject.pipe(takeUntil(notifier)).subscribe({
        next: ([i, skipBlock]) => {
          if (i == pageSize) {
            pageDone++;
            if (pageDone == numPages) {

              //if (skipBlock.forwardLinks.length != 0) {

              if (repeatCounter < 1) {
                repeatCounter++;
                const next = skipBlock.forwardLinks[0].to.toString("hex");
                pageDone = 0;
                getBlock(next);
              } else {
                notifier.next();
                notifier.complete();
              }
            }
          }
        }
      });
      getBlock(firstBlockID);
    })
    document.getElementById("next-button").addEventListener("click", nextMINE)
    document.getElementById("browse").addEventListener("click", browse)
}

function getBlock(firstBlockID:string){
  console.log("*****************Get Blocks*****************")

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
              subject.next([runCount, data.blocks[i]]);
              printdata(data.blocks[i], count, data.pagenumber)
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
}

function printdata(block:SkipBlock, blockIndex:number, pageNum: number){
  console.log("*****************Print Data*****************")

  const payload = block.payload
  const body = DataBody.decode(payload)
  console.log("- block: "+ blockIndex + ", page "+pageNum+ ", hash: "+block.hash.toString(
    "hex"))
  body.txResults.forEach((transaction, i)=>{
    console.log("\n-- Transaction: "+i)
    transaction.clientTransaction.instructions.forEach((instruction, j) => {
      console.log("\n--- Instruction "+j)
      console.log("\n---- Hash: " +  instruction.hash().toString("hex"))
      console.log("\n---- Instance ID: " + instruction.instanceID.toString("hex"))
      if(instruction.spawn !== null){
        console.log("\n---- spawn" )
      }
      if(instruction.invoke !== null){
        console.log("\n---- invoke" )
      }
    });
  });
return 0
}

function nextMINE(e?: Event){
  console.log("*****************NEXT*****************")
  if (lastBlock === undefined) {
    console.log("please first load a page"); //TOBE CHANGED AFTERWARDS
    return;
  }
  if (lastBlock.forwardLinks.length == 0) {
    console.log("no more blocks to fetch (list of forwardlinks empty");
    return;
  }
  firstBlockID = lastBlock.forwardLinks[0].to.toString("hex");
  
  getBlock(firstBlockID)
}


function browse(e:Event){
  console.log("*****************browse*****************")

  if (lastBlock === undefined) {
    console.log("please first load a page");
    return;
  }

  printdata(lastBlock, 0, 0)
  var nextID: string;

  if (lastBlock.forwardLinks.length == 0) {
    console.log("no more blocks to fetch (list of forwardlinks empty");
    return;
  }
  nextID = lastBlock.forwardLinks[0].to.toString("hex");
  
  const notifier = new Subject();
  var pageDone = 0;
  var repeatCounter = 0
  contractID = (document.getElementById("contractID") as HTMLInputElement).value
  subject.pipe(takeUntil(notifier)).subscribe({
    // As a reminder: if the observer sends an error or a "complete" message,
    // we cannot use the observer anymore. This is why the ws callback does not
    // send an observer error if one occurs, since we need to keep the same
    // observer during the entire session.
    next: ([i, skipBlock]) => {
      if (i == pageSize) {
        pageDone++;
        if (pageDone == numPages) {
          //if (repeatCounter < 100) {

          if (skipBlock.forwardLinks.length != 0) {
            repeatCounter++
            var next: string = skipBlock.forwardLinks[0].to.toString("hex");
            pageDone = 0;
            getBlockB(next, pageSize, numPages);
          } else{
            notifier.next();
            notifier.complete();
          }
        }
      }
    }
  });
  getBlockB(nextID, pageSize, numPages);
}




function getBlockB(
  firstBlockID: string,
  pageSize: number,
  numPages: number){
  console.log("*****************getBlockB*****************")

  var bid: Buffer;
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
  //if (ws === undefined) {   /DISCUTER DE CA?
    conn.sendStream<PaginateResponse>(
      new PaginateRequest({
        startid: bid,
        pagesize: pageSize,
        numpages: numPages,
        backward: false
      }),
      PaginateResponse).subscribe({
      // ws callback "onMessage":
        next: ([data, ws])=>{
          nextB([data, ws])
        },
        complete: () => {
          console.log("closed");
        },
        error: (err: Error) => {
          console.log("error: ", err);
          ws = undefined;
        }
      });
    /*}else{
      const message = new PaginateRequest({
        startid: bid,
        pagesize: pageSize,
        numpages: numPages,
        backward: false
      });
      const messageByte = Buffer.from(message.$type.encode(message).finish());
      ws.send(messageByte);
    }*/
    
}

function nextB([data, localws]: [PaginateResponse, WebSocketAdapter]){
  var count = 0
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
      count++;
      if (count % logEach == 0) {
        var block = data.blocks[i]
        subject.next([runCount, data.blocks[i]]);
        const payload = block.payload
        const body = DataBody.decode(payload)
        body.txResults.forEach((transaction)=> {
          transaction.clientTransaction.instructions.forEach((instruction)=>{
            /*if(instruction.instanceID.toString("hex") == contractID){
                console.log("*****************Contract match found*****************")
                blocks.push(data.blocks[i].hash.toString("hex"))
                printdata(block, count, data.pagenumber)
              }*/
              //printdata(block, count, data.pagenumber)
              console.log("- block: "+ count + ", page "+data.pagenumber+ ", hash: "+block.hash.toString("hex"))
            })
        })

      }
    }
    lastBlock = data.blocks[data.blocks.length-1]
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
