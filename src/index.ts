import { Roster, WebSocketAdapter } from '@dedis/cothority/network';
import { SkipBlock } from '@dedis/cothority/skipchain';
import { WebSocketConnection } from '@dedis/cothority/network/connection';
import { ByzCoinRPC, Instruction } from '@dedis/cothority/byzcoin';
import { PaginateResponse, PaginateRequest } from '@dedis/cothority/byzcoin/proto/stream';
import { Subject } from 'rxjs';
import { DataBody } from '@dedis/cothority/byzcoin/proto';

var roster: Roster;
var ws: WebSocketAdapter;
const firstBlockIDStart = "a6ace9568618f63df1c77544fafc56037bf249e4749fb287ca82cc55edc008f8" //"9cc36071ccb902a1de7e0d21a2c176d73894b1cf88ae4cc2ba4c95cd76f474f3"
              //DELETE contract: 30acb65139f5f9b479eaea33dae7ccf5704b3b0cf446dff1fb5d6b60b95caa59
const pageSize = 15 //combien de blocks je veux          Expliquer que 20/20 est bon car testé deja
const numPages = 15 //nombre de requete pour faire du streaming: 50 blocks, en 5 requete asynchrone. 
//nombre de block total: pagesize * numpages
var nextIDB: string = ""
var totalBlocks = 36440
var seenBlocks = 0
var matchfound = 0

var contractID = ""
var blocks: SkipBlock[] = []
var instanceSearch :Instruction

export function sayHi() {
  roster = Roster.fromTOML(rosterStr);
  if (!roster) {
    console.log("Roster is undefined")
    return;
  }
  document.getElementById("browse").addEventListener("click", browseClick)
  document.getElementById("show").addEventListener("click", show)

}

function show(e:Event){
  console.log(seenBlocks)
  showInstance(instanceSearch)
}

function showInstance(instance : Instruction){
  console.log("Number of blocks seen: "+seenBlocks+", total should be: "+totalBlocks)
  //browse(pageSize, numPages, firstBlockIDStart, instance)
  showSpawn(instance)
  showInvoke(instance)
  showDelete(instance)

}

function showSpawn(instance:Instruction){
  const payload = blocks[0].payload
  const body = DataBody.decode(payload)
  body.txResults.forEach((transaction) => {
    transaction.clientTransaction.instructions.forEach((instruction, j) => {
      if(instruction.instanceID.toString("hex") === instance.instanceID.toString("hex")){
        if (instruction.spawn !== null) {
          console.log("\n--- Instruction spawn")
          console.log("\n---- Hash: " + instruction.hash().toString("hex"))
          console.log("\n---- Instance ID: " + instruction.instanceID.toString("hex"))
        }
      }
    });
  });
}

function showInvoke(instance:Instruction){
  var j = 0
  for(let i = 0; i < blocks.length; i++){
    const payload = blocks[i].payload
    const body = DataBody.decode(payload)
    body.txResults.forEach((transaction) => {
      transaction.clientTransaction.instructions.forEach((instruction) => {
        if(instruction.instanceID.toString("hex") === instance.instanceID.toString("hex")){
          matchfound++
          if (instruction.invoke !== null) {
            console.log("\n--- Instruction invoke :" + j++)
            console.log("\n---- Hash: " + instruction.hash().toString("hex"))
            console.log("\n---- Instance ID: " + instruction.instanceID.toString("hex"))
          }
        }
      });
    });
  }
}

function showDelete(instance:Instruction){
  const payload = blocks[blocks.length-1].payload
  const body = DataBody.decode(payload)
  body.txResults.forEach((transaction) => {
    transaction.clientTransaction.instructions.forEach((instruction) => {
      if(instruction.instanceID.toString("hex") === instance.instanceID.toString("hex")){
        if (instruction.delete !== null) {
          console.log("\n--- Instruction delete 1")
          console.log("\n---- Hash: " + instruction.hash().toString("hex"))
          console.log("\n---- Instance ID: " + instruction.instanceID.toString("hex"))
        }
      }
    });
  });
}

function printdata(block: SkipBlock, pageNum: number) {
  const payload = block.payload
  const body = DataBody.decode(payload)
  console.log("- block: " + seenBlocks + ", page " + pageNum + ", hash: " + block.hash.toString(
    "hex"))
  body.txResults.forEach((transaction, i) => {
    console.log("\n-- Transaction: " + i)
    transaction.clientTransaction.instructions.forEach((instruction, j) => {
      console.log("\n--- Instruction " + j)
      console.log("\n---- Hash: " + instruction.hash().toString("hex"))
      console.log("\n---- Instance ID: " + instruction.instanceID.toString("hex"))
      if (instruction.spawn !== null) {
        console.log("\n---- spawn")
      }
      if (instruction.invoke !== null) {
        console.log("\n---- invoke")
      }
    });
  });
  return 0
}

function browseClick(e: Event) {
  ws = undefined
  nextIDB = ""
  totalBlocks = 36440
  seenBlocks = 0
  matchfound = 0
     
  contractID = ""
  blocks = []
  instanceSearch = null
  browse(pageSize, numPages, firstBlockIDStart, instanceSearch)
}

function browse(pageSizeB: number,
  numPagesB: number, firstBlockID: string, instance: Instruction) {
  instanceSearch = instance
  var subjectBrowse = new Subject<[number, SkipBlock]>();
  var pageDone = 0;
  contractID = (document.getElementById("contractID") as HTMLInputElement).value
  subjectBrowse.subscribe({
    next: ([i, skipBlock]) => {
      if (i == pageSizeB) {
        pageDone++;
        if (pageDone == numPagesB) {
          if (skipBlock.forwardLinks.length != 0) {
            nextIDB = skipBlock.forwardLinks[0].to.toString("hex");
            pageDone = 0;
            getNextBlocks(nextIDB, pageSizeB, numPagesB, subjectBrowse);
          } else {
            subjectBrowse.complete()
          }
        }
      }
    },
    complete: () => {
      console.log("Fin de la Blockchain")
      console.log("closed")
    },
    error: (err: any) => {
      console.log("error: ", err);
      if (err === 1) {
        console.log("Browse recall: " + 1)
        ws = undefined //To reset the websocket, create a new handler for the next function (of getnextblock)
        browse(1, 1, nextIDB, instance)
      }
    }
  });

  getNextBlocks(firstBlockID, pageSizeB, numPagesB, subjectBrowse);
  console.log(blocks)
  return subjectBrowse
}

function getNextBlocks(
  nextID: string,
  pageSizeNB: number,
  numPagesNB: number,
  subjectBrowse: Subject<[number, SkipBlock]>) {
  var bid: Buffer;
  nextIDB = nextID
  try {
    bid = hex2Bytes(nextID);
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
  if (ws !== undefined) {
    const message = new PaginateRequest({
      startid: bid,
      pagesize: pageSizeNB,
      numpages: numPagesNB,
      backward: false
    });

    const messageByte = Buffer.from(message.$type.encode(message).finish());
    ws.send(messageByte);  //fetch next block

  } else {

    conn.sendStream<PaginateResponse>(  //fetch next block
      new PaginateRequest({
        startid: bid,
        pagesize: pageSizeNB,
        numpages: numPagesNB,
        backward: false
      }),
      PaginateResponse).subscribe({
        // ws callback "onMessage":
        next: ([data, ws]) => {
          var ret = handlePageResponse(data, ws, subjectBrowse)
          if (ret == 1) {
            console.log("Error Handling with a return 1")
            subjectBrowse.error(1)
          }
        },
        complete: () => {
          console.log("closed");
        },
        error: (err: Error) => {
          console.log("error: ", err);
          ws = undefined;
        }
      });
  }
}

function handlePageResponse(data: PaginateResponse, localws: WebSocketAdapter, subjectBrowse: Subject<[number, SkipBlock]>) {
  if (data.errorcode != 0) {
    console.log(
      `got an error with code ${data.errorcode} : ${data.errortext}`
    );
    return 1;
  }
  if (localws !== undefined) {
    ws = localws
  }
  var runCount = 0;
  for (var i = 0; i < data.blocks.length; i++) {
    seenBlocks++
    runCount++;
    var block = data.blocks[i]
    subjectBrowse.next([runCount, data.blocks[i]]);
    const payload = block.payload
    const body = DataBody.decode(payload)
    body.txResults.forEach((transaction) => {
      transaction.clientTransaction.instructions.forEach((instruction) => {
        if (instruction.instanceID.toString("hex") === contractID) {
          console.log("*****************Contract match found*****************")
          if(!blocks.includes(data.blocks[i])){
            instanceSearch = instruction
            blocks.push(data.blocks[i])
          }
          printdata(block, data.pagenumber)
        }
      })
    })
  }
  return 0;
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
