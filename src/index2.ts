// Columbus
//
// Duplex streaming navigator
// An improved version using Observable
//

import { SkipchainRPC, SkipBlock } from "@dedis/cothority/skipchain";
import { Roster } from "@dedis/cothority/network/proto";
import {
  IConnection,
  WebSocketConnection,
  RosterWSConnection
} from "@dedis/cothority/network/connection";
import { StatusRequest, StatusResponse } from "@dedis/cothority/status/proto";
import StatusRPC from "@dedis/cothority/status/status-rpc";
import { ByzCoinRPC } from "@dedis/cothority/byzcoin";
import { DataBody } from "@dedis/cothority/byzcoin/proto";
import {
  GetSingleBlockByIndexReply,
  GetSingleBlock
} from "@dedis/cothority/skipchain/proto";
import {
  StreamingRequest,
  StreamingResponse,
  PaginateRequest,
  PaginateResponse
} from "@dedis/cothority/byzcoin/proto/stream";
import { WebSocketAdapter } from "@dedis/cothority/network";

import { Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";

// To keep track of the latest block fetched
var lastBlock: SkipBlock;
// HTML form elements that holds the user's options
var numBlocksInput: HTMLInputElement;
var numPagesInput: HTMLInputElement;
var inputBlock: HTMLInputElement;
var logEachInput: HTMLInputElement;
var detailsInput: HTMLInputElement;
var statsTarget: HTMLElement;
// To re-use the same ws connection across runs
var ws: WebSocketAdapter;
// The roster
var roster: Roster;
// Used from the ws callback to send events to the caller
const subject = new Subject<number>();
// Those two need to be global so we can update them across multiple ws
// callback
var printDetails: boolean;
var logEach: number;

export function sayHi() {
  console.log("SayHi")
  numBlocksInput = document.getElementById(
    "num-blocks-input" //blocks/page input
  ) as HTMLInputElement;
  numPagesInput = document.getElementById(
    "num-pages-input" //num pages input
  ) as HTMLInputElement;
  inputBlock = document.getElementById("block-input") as HTMLInputElement; //skipchain number
  logEachInput = document.getElementById("log-each-input") as HTMLInputElement; //log each input
  statsTarget = document.getElementById("stats-info"); //$???
  detailsInput = document.getElementById("details-input") as HTMLInputElement; //print details

  roster = Roster.fromTOML(rosterStr);//server ID
  if (!roster) {
    prependLog("roster is undefined");
    return;
  }
  document
    .getElementById("load-button")
    .addEventListener("click", (e: Event) => {
      const firstBlockID = inputBlock.value;
      const pageSize = parseInt(numBlocksInput.value);
      const numPages = parseInt(numPagesInput.value);
      logEach = parseInt(logEachInput.value);
      printDetails = detailsInput.checked;
      statsTarget.innerText = "";

      if (ws != undefined) {
        ws.close(1000, "new load");
        ws = undefined;
      }
      document.getElementById("status").innerHTML = "";
      const notifier = new Subject();
      var startTime = performance.now();
      var pageDone = 0;
      subject.pipe(takeUntil(notifier)).subscribe({
        next: (i: number) => {
          if (i == pageSize) {
            pageDone++;
            if (pageDone == numPages) {
              printStat(startTime, pageDone * pageSize);
              notifier.next();
              notifier.complete();
            }
          }
        }
      });
      printBlocks(firstBlockID, pageSize, numPages, false);
    });

  document.getElementById("forward-button").addEventListener("click", load);
  document.getElementById("backward-button").addEventListener("click", load);
}

// Called by the "next" and "previous" buttons. It fetches the options in case
// the user changed them, subscribe to the observer and then call the fetch
// function.
function load(e: Event) {
  console.log("LOAD")
  if (lastBlock === undefined) {
    prependLog("please first load a page");
    return;
  }

  var reversed: boolean;
  var nextID: string;

  if ((<HTMLInputElement>e.currentTarget).dataset.reversed === "true") {
    reversed = true;
    if (lastBlock.backlinks.length == 0) {
      prependLog("no more blocks to fetch (list of backlinks empty");
      return;
    }
    nextID = lastBlock.backlinks[0].toString("hex");
  } else {
    reversed = false;
    if (lastBlock.forwardLinks.length == 0) {
      prependLog("no more blocks to fetch (list of forwardlinks empty");
      return;
    }
    nextID = lastBlock.forwardLinks[0].to.toString("hex");
  }
  const pageSize = parseInt(numBlocksInput.value);
  console.log("numBlocksInput : "+ numBlocksInput.value)
  const numPages = parseInt(numPagesInput.value);
  console.log("numPagesInput : "+ numPagesInput.value)
  logEach = parseInt(logEachInput.value);
  printDetails = detailsInput.checked;
  const notifier = new Subject();
  var startTime = performance.now();
  var pageDone = 0;
  subject.pipe(takeUntil(notifier)).subscribe({
    // As a reminder: if the observer sends an error or a "complete" message,
    // we cannot use the observer anymore. This is why the ws callback does not
    // send an observer error if one occurs, since we need to keep the same
    // observer during the entire session.
    next: (i: number) => {
      if (i == pageSize) {
        pageDone++;
        if (pageDone == numPages) {
          printStat(startTime, pageDone * pageSize);
          notifier.next();
          notifier.complete();
        }
      }
    }
  });
  printBlocks(nextID, pageSize, numPages, reversed);
}

// This funtion calls the sendStream with the corresponding paginateBlocks
// request. If the ws is already defined, it does not create a new one by
// calling again the sendStream function, but directly call a send on the ws
function printBlocks(
  firstBlockID: string, //hash du block
  pageSize: number,
  numPages: number,
  backward: boolean
) {
  console.log("printBlocks")
  var bid: Buffer;
  try {
    bid = hex2Bytes(firstBlockID);
  } catch (error) {
    prependLog("failed to parse the block ID: ", error);
    return;
  }

  try {
    var conn = new WebSocketConnection(
      roster.list[0].getWebSocketAddress(),
      ByzCoinRPC.serviceName
    );
  } catch (error) {
    prependLog("error creating conn: ", error);
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
            prependLog(
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
                prependLog(
                  longBlockString(data.blocks[i], count, data.pagenumber)
                );
              } else {
                prependLog(
                  shortBlockString(data.blocks[i], count, data.pagenumber)
                );
              }
            }
          }
          lastBlock = data.blocks[data.blocks.length - 1];
        },
        complete: () => {
          prependLog("closed");
        },
        error: (err: Error) => {
          prependLog("error: ", err);
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

// Makes a short string representation of a block
function shortBlockString(
  block: SkipBlock,
  blockIndex: number,
  pageNum: number
): string {
  console.log("shortBlockString")
  var output = `- block: ${blockIndex}, page ${pageNum}, hash: ${block.hash.toString(
    "hex"
  )}`;
  return output;
}

// Makes a detailed string representation of a block
function longBlockString(
  block: SkipBlock,
  blockIndex: number,
  pageNum: number
): string {
  console.log("longBlockString")

  var output = shortBlockString(block, blockIndex, pageNum);
  const payload = block.payload;
  const body = DataBody.decode(payload);
  body.txResults.forEach((transaction, i) => {
    output += `\n-- Transaction ${i}`;
    transaction.clientTransaction.instructions.forEach((instruction, j) => {
      output += `\n--- Instruction ${j}`;
      output += `\n---- Hash: ${instruction.hash().toString("hex")}`;
      output += `\n---- Instance ID: ${instruction.instanceID.toString("hex")}`;
      if (instruction.spawn !== null) {
        output += `\n---- Spawn:`;
        output += `\n----- ContractID: ${instruction.spawn.contractID}`;
        output += `\n----- Args:`;
        instruction.spawn.args.forEach((arg, _) => {
          output += `\n------ Arg:`;
          output += `\n------- Name: ${arg.name}`;
          output += `\n------- Value: ${arg.value}`;
        });
      } else if (instruction.invoke !== null) {
        output += `\n---- Invoke:`;
        output += `\n----- ContractID: ${instruction.invoke.contractID}`;
        output += `\n----- Args:`;
        instruction.invoke.args.forEach((arg, _) => {
          output += `\n------ Arg:`;
          output += `\n------- Name: ${arg.name}`;
          output += `\n------- Value: ${arg.value}`;
        });
      } else if (instruction.delete !== null) {
        output += `\n---- Delete: ${instruction.delete}`;
      }
    });
  });
  output += `\n-- Verifiers (${block.verifiers.length}):`;
  block.verifiers.forEach((uid, j) => {
    output += `\n--- Verifier ${j}`;
    output += `\n---- ${uid.toString("hex")}`;
  });
  output += `\n-- Backlinks (${block.verifiers.length}):`;
  block.backlinks.forEach((value, j) => {
    output += `\n--- Backlink ${j}`;
    output += `\n---- ${value.toString("hex")}`;
  });
  output += `\n-- Forwardlinks (${block.forwardLinks.length}):`;
  block.forwardLinks.forEach((fl, j) => {
    output += `\n--- Forwardlink ${j}`;
    output += `\n---- from: ${fl.from.toString("hex")}`;
    output += `\n---- hash: ${fl.hash().toString("hex")}`;
    output += `\n---- signature: ${fl.signature.sig.toString("hex")}`;
  });
  return output;
}

//
// Print log stuff
//

var logCounter = 0;
var blockCounter = 0;
var statusHolder: HTMLElement;
var keepScroll: HTMLInputElement;
var t0: number;

export function prependLog(...nodes: Array<Node | any>) {
  console.log("prependLog")

  const wrapper = document.createElement("div");
  wrapper.classList.add("log-entry-wrapper");
  const contentWrapper = document.createElement("pre");
  contentWrapper.classList.add("nice-scroll2");
  const infos = document.createElement("div");
  infos.classList.add("log-info");
  infos.append(logCounter + "");
  contentWrapper.append(...nodes);
  wrapper.append(infos, contentWrapper);
  if (statusHolder === undefined) {
    statusHolder = document.getElementById("status");
  }
  statusHolder.append(wrapper);
  logCounter++;
  updateScroll();
}

function updateScroll() {
  console.log("updateScroll")

  if (keepScroll === undefined) {
    keepScroll = document.getElementById("keep-scroll") as HTMLInputElement;
  }
  if (keepScroll.checked == true) {
    statusHolder.scrollTop = statusHolder.scrollHeight;
  }
}

function hex2Bytes(hex: string) {
  if (!hex) {
    return Buffer.allocUnsafe(0);
  }

  return Buffer.from(hex, "hex");
}

function printStat(startTime: number, count: number) {
  const elapsed = performance.now() - startTime;
  statsTarget.innerText =
    "Took " +
    Math.round(elapsed * 100) / 100 +
    "ms for " +
    count +
    " blocks (" +
    Math.round((count / elapsed) * 1000 * 100) / 100 +
    " blocks/s)";
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
