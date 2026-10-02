import { describe, it, expect } from "vitest";
import { parseControlState } from "./control-state";
const valid = {schemaVersion:1,profile:null,account:{signedIn:false},credentials:[],customProviders:[],providers:[],models:[]};
describe("configuration response boundary", () => {
 it("validates explicit model readiness", () => {
  expect(parseControlState({...valid,modelReady:false}).modelReady).toBe(false);
  expect(parseControlState({...valid,modelReady:true}).modelReady).toBe(true);
  expect(()=>parseControlState({...valid,modelReady:"yes"})).toThrow();
 });
 it("accepts complete empty state", () => expect(parseControlState(valid).customProviders).toEqual([]));
 it("rejects the old response that crashed connection rendering", () => {
   const {customProviders, ...old} = valid;
   expect(() => parseControlState(old)).toThrow("incompatible");
 });
 it("rejects missing arrays, malformed rows and invalid versions", () => {
   for (const key of ["credentials","providers","models","customProviders"]) {
     expect(() => parseControlState({...valid,[key]:undefined})).toThrow();
     expect(() => parseControlState({...valid,[key]:[null]})).toThrow();
   }
   expect(() => parseControlState({...valid,schemaVersion:2})).toThrow();
   expect(() => parseControlState({...valid,providers:[{id:"",name:"bad"}]})).toThrow();
 });
});
