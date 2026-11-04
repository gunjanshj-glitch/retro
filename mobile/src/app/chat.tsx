import { useMutation } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { FLOW, nextStep, progress, toEnquiry, validate, whatsappUrl, type Answers } from "@retro/chat-flow";
import { api } from "@/lib/api";
import { WHATSAPP } from "@/lib/env";
import { messageOf } from "@/lib/errors";
import { Button, Card, Chip, ChipRow, ErrorBox, Field, Screen, Text } from "@/ui";
import { useTheme } from "@/theme";

export default function Chat() {
  const c = useTheme();
  const [answers, setAnswers] = useState<Answers>({});
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const key = useRef(api.key()).current; // a retried submit can never store the lead twice

  const step = nextStep(answers, skipped);
  const p = progress(answers, skipped);

  const send = useMutation({
    mutationFn: async () => {
      const lead = toEnquiry(answers, "app-chat");
      if (!lead) throw new Error("Please add your name and a valid mobile number.");
      await api.enquiries.create(lead, key);
    },
  });

  function answer(value: string) {
    if (!step) return;
    const v = validate(step, value);
    if (!v.ok) return setError(v.error);
    setError(null);
    setAnswers((a) => ({ ...a, [step.id]: v.value }));
    setInput("");
  }

  if (send.isSuccess) {
    return (
      <Screen>
        <Text variant="title">Thank you, {answers.name}</Text>
        <Text>We have your details and will call you on {answers.phone}. If you would rather chat now, send us the summary on WhatsApp.</Text>
        <Button label="Continue on WhatsApp" onPress={() => void Linking.openURL(whatsappUrl(WHATSAPP, answers))} />
        <Button label="Done" kind="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="label" dim>Step {Math.min(p.done + 1, p.total)} of {p.total}</Text>
      {step ? (
        <>
          <Card><Text variant="heading">{step.ask}</Text></Card>
          {step.kind === "choice" ? (
            <ChipRow>{step.options.map((o) => <Chip key={o} label={o} onPress={() => answer(o)} />)}</ChipRow>
          ) : (
            <>
              <Field label={step.placeholder ?? "Your answer"} value={input} onChangeText={setInput} keyboardType={step.validate === "phone" ? "phone-pad" : "default"} autoComplete={step.validate === "phone" ? "tel" : "name"} onSubmitEditing={() => answer(input)} />
              <Button label="Next" onPress={() => answer(input)} />
            </>
          )}
          {step.skippable ? <Button label="Skip" kind="secondary" onPress={() => setSkipped(new Set([...skipped, step.id]))} /> : null}
        </>
      ) : (
        <>
          <Card>
            <Text variant="heading">Does this look right?</Text>
            {FLOW.filter((s) => answers[s.id]).map((s) => <Text key={s.id} dim>{s.id}: <Text color={c.text}>{answers[s.id]}</Text></Text>)}
          </Card>
          <Text variant="small" dim>Retro Holidays will contact you on this number about your trip. We never share it.</Text>
          <Button label="Send to Retro Holidays" busy={send.isPending} onPress={() => send.mutate()} />
        </>
      )}
      {error ? <ErrorBox message={error} /> : null}
      {send.error ? <ErrorBox message={messageOf(send.error)} /> : null}
      <Button label="Chat on WhatsApp instead" kind="secondary" onPress={() => void Linking.openURL(whatsappUrl(WHATSAPP, answers))} />
    </Screen>
  );
}
