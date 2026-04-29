// Sample messages for the Ingest demo. Bundled as constants so the user can
// click "Load sample" instead of finding a file.

export const SAMPLE_HL7V2_ADT = `MSH|^~\\&|ADT|MERCY-HOSP|EHR|REGIONAL|20240803143015||ADT^A01|MSG00042|P|2.5
EVN|A01|20240803143015|||DRSMITH^Smith^Jane^A
PID|1||PT12345^^^MRN||DOE^JOHN^A||19700515|M||2106-3|88 CEDAR LN^^BOSTON^MA^02118^US||(617)555-0145|||S|NON|ACCT-2024-9988
PV1|1|I|MED-3W^301^A^MERCY-HOSP|EM|||DRSMITH^Smith^Jane^A^^^MD|||MED||||EMER|||||||||||||||||||||||||||20240803143015
DG1|1|I10|I50.9^Heart failure unspecified^I10|Heart failure unspecified|20240803|A
AL1|1|DA|764146007^Penicillin^SCT|MO|Hives`;

export const SAMPLE_HL7V2 = `MSH|^~\\&|LAB|MERCY-HOSP|EHR|REGIONAL|20240715102530||ORU^R01|MSG00001|P|2.5
PID|1||PT12345^^^MRN||DOE^JOHN^A||19700515|M
OBR|1|ORD123|FILL456|24356-8^Lipid panel^LN|||20240715090000
OBX|1|NM|2093-3^Cholesterol Total^LN||215|mg/dL|<200|H|||F|||20240715090000
OBX|2|NM|2571-8^Triglycerides^LN||189|mg/dL|<150|H|||F|||20240715090000
OBX|3|NM|2085-9^HDL Cholesterol^LN||38|mg/dL|>40|L|||F|||20240715090000
OBX|4|NM|2089-1^LDL Cholesterol^LN||142|mg/dL|<100|H|||F|||20240715090000
OBX|5|NM|4548-4^Hemoglobin A1c^LN||7.4|%|<5.7|H|||F|||20240715090000
OBR|2|ORD124|FILL457|94531-1^CMP^LN|||20240715090000
OBX|1|NM|2160-0^Creatinine^LN||1.1|mg/dL|0.7-1.3|N|||F|||20240715090000
OBX|2|NM|2823-3^Potassium^LN||4.2|mEq/L|3.5-5.0|N|||F|||20240715090000
OBX|3|NM|17861-6^Calcium^LN||9.4|mg/dL|8.5-10.2|N|||F|||20240715090000`;

export const SAMPLE_CCDA = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <id root="2.16.840.1.113883.19.5.99999.1" extension="DOC-2024-08-22-001"/>
  <code code="11488-4" codeSystem="2.16.840.1.113883.6.1" displayName="Consultation note"/>
  <title>Discharge Summary</title>
  <effectiveTime value="20240822103000"/>
  <component>
    <structuredBody>
      <component>
        <section>
          <templateId root="2.16.840.1.113883.10.20.22.2.5"/>
          <code code="11450-4" codeSystem="2.16.840.1.113883.6.1" displayName="Problem list"/>
          <title>Problems</title>
          <entry>
            <act classCode="ACT" moodCode="EVN">
              <statusCode code="active"/>
              <effectiveTime><low value="20180622"/></effectiveTime>
              <entryRelationship typeCode="SUBJ">
                <observation classCode="OBS" moodCode="EVN">
                  <statusCode code="completed"/>
                  <effectiveTime><low value="20180622"/></effectiveTime>
                  <value xsi:type="CD" code="44054006" codeSystem="2.16.840.1.113883.6.96" displayName="Type 2 diabetes mellitus" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
                </observation>
              </entryRelationship>
            </act>
          </entry>
          <entry>
            <act classCode="ACT" moodCode="EVN">
              <statusCode code="active"/>
              <effectiveTime><low value="20210112"/></effectiveTime>
              <entryRelationship typeCode="SUBJ">
                <observation classCode="OBS" moodCode="EVN">
                  <statusCode code="completed"/>
                  <effectiveTime><low value="20210112"/></effectiveTime>
                  <value xsi:type="CD" code="55822004" codeSystem="2.16.840.1.113883.6.96" displayName="Hyperlipidemia" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
                </observation>
              </entryRelationship>
            </act>
          </entry>
        </section>
      </component>
      <component>
        <section>
          <templateId root="2.16.840.1.113883.10.20.22.2.1"/>
          <code code="10160-0" codeSystem="2.16.840.1.113883.6.1" displayName="Medications"/>
          <title>Medications</title>
          <entry>
            <substanceAdministration classCode="SBADM" moodCode="EVN">
              <statusCode code="active"/>
              <effectiveTime><low value="20180622"/></effectiveTime>
              <doseQuantity value="500" unit="mg"/>
              <consumable>
                <manufacturedProduct>
                  <manufacturedMaterial>
                    <code code="860975" codeSystem="2.16.840.1.113883.6.88" displayName="Metformin hydrochloride 500 MG Oral Tablet"/>
                    <name>Metformin 500mg</name>
                  </manufacturedMaterial>
                </manufacturedProduct>
              </consumable>
            </substanceAdministration>
          </entry>
          <entry>
            <substanceAdministration classCode="SBADM" moodCode="EVN">
              <statusCode code="active"/>
              <effectiveTime><low value="20210112"/></effectiveTime>
              <doseQuantity value="20" unit="mg"/>
              <consumable>
                <manufacturedProduct>
                  <manufacturedMaterial>
                    <code code="617314" codeSystem="2.16.840.1.113883.6.88" displayName="Atorvastatin 20 MG Oral Tablet"/>
                    <name>Atorvastatin 20mg</name>
                  </manufacturedMaterial>
                </manufacturedProduct>
              </consumable>
            </substanceAdministration>
          </entry>
        </section>
      </component>
      <component>
        <section>
          <templateId root="2.16.840.1.113883.10.20.22.2.6"/>
          <code code="48765-2" codeSystem="2.16.840.1.113883.6.1" displayName="Allergies"/>
          <title>Allergies</title>
          <entry>
            <act classCode="ACT" moodCode="EVN">
              <statusCode code="active"/>
              <effectiveTime><low value="20100912"/></effectiveTime>
              <entryRelationship typeCode="SUBJ">
                <observation classCode="OBS" moodCode="EVN">
                  <statusCode code="completed"/>
                  <effectiveTime><low value="20100912"/></effectiveTime>
                  <value xsi:type="CD" code="419511003" codeSystem="2.16.840.1.113883.6.96" displayName="Drug allergy" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
                  <participant typeCode="CSM">
                    <participantRole classCode="MANU">
                      <playingEntity>
                        <code code="764146007" codeSystem="2.16.840.1.113883.6.96" displayName="Penicillin"/>
                      </playingEntity>
                    </participantRole>
                  </participant>
                  <entryRelationship typeCode="MFST" inversionInd="true">
                    <observation classCode="OBS" moodCode="EVN">
                      <code code="REACTION" displayName="Reaction"/>
                      <statusCode code="completed"/>
                      <value xsi:type="CD" code="247472004" codeSystem="2.16.840.1.113883.6.96" displayName="Hives" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
                    </observation>
                  </entryRelationship>
                </observation>
              </entryRelationship>
            </act>
          </entry>
        </section>
      </component>
      <component>
        <section>
          <templateId root="2.16.840.1.113883.10.20.22.2.3"/>
          <code code="30954-2" codeSystem="2.16.840.1.113883.6.1" displayName="Relevant diagnostic tests"/>
          <title>Results</title>
          <entry>
            <organizer classCode="BATTERY" moodCode="EVN">
              <statusCode code="completed"/>
              <component>
                <observation classCode="OBS" moodCode="EVN">
                  <code code="4548-4" codeSystem="2.16.840.1.113883.6.1" displayName="Hemoglobin A1c"/>
                  <statusCode code="completed"/>
                  <effectiveTime value="20240820"/>
                  <value xsi:type="PQ" value="6.9" unit="%" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
                  <interpretationCode code="N"/>
                </observation>
              </component>
              <component>
                <observation classCode="OBS" moodCode="EVN">
                  <code code="2160-0" codeSystem="2.16.840.1.113883.6.1" displayName="Creatinine"/>
                  <statusCode code="completed"/>
                  <effectiveTime value="20240820"/>
                  <value xsi:type="PQ" value="0.9" unit="mg/dL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
                  <interpretationCode code="N"/>
                </observation>
              </component>
            </organizer>
          </entry>
        </section>
      </component>
    </structuredBody>
  </component>
</ClinicalDocument>`;
