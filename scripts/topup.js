const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const nearApi=require("near-api-js");
const RPC="https://test.rpc.fastnear.com", NET="testnet";
const [from,to,amt]=process.argv.slice(2);
(async()=>{
 const c=JSON.parse(fs.readFileSync(path.join(os.homedir(),".near-credentials",NET,from+".json"),"utf8"));
 const {keyStores,KeyPair,connect,transactions}=nearApi;
 const ks=new keyStores.InMemoryKeyStore(); ks.setKey(NET,from,KeyPair.fromString(c.private_key));
 const near=await connect({networkId:NET,nodeUrl:RPC,keyStore:ks});
 const a=await near.account(from);
 const r=await a.signAndSendTransaction({receiverId:to,actions:[transactions.transfer(BigInt(Math.round(Number(amt)*1e24)))]});
 console.log("sent",amt,"NEAR ->",to,"tx",r.transaction_outcome.id);
})();
