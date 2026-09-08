import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('monitoring', Path(__file__).resolve().parents[1] / 'scripts/monitoring.py')
monitoring = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitoring)


class MonitoringCliTest(unittest.TestCase):
    outputs = {'AlertTopicArn': 'arn:aws:sns:us-east-2:000000000000:fixture', 'MonitoringTestAlarmName': 'fixture-alarm', 'MonitoringFunctionName': 'fixture-monitor'}

    def aws(self, *args):
        if args[:2] == ('sns', 'list-subscriptions-by-topic'):
            return {'Subscriptions': [{'Protocol': 'email', 'SubscriptionArn': 'arn:fixture:confirmed'}]}
        if args[:2] == ('cloudwatch', 'describe-alarms'):
            return {'MetricAlarms': [{'ActionsEnabled': True, 'AlarmActions': [self.outputs['AlertTopicArn']], 'OKActions': [self.outputs['AlertTopicArn']]}]}
        raise AssertionError(args)

    def test_success_checks_real_transition_actions_then_resets(self):
        signals, states, actions = [], [], []
        def call(_aws, _fn, event): signals.append(event['signal'])
        def wait(_aws, _alarm, expected, _timeout):
            states.append(expected)
            return {'StateValue': expected}
        def action(_aws, _name, state, _topic, _timeout):
            actions.append(state['StateValue'])
            return {'snsPublish': 'Succeeded'}
        report = monitoring.exercise(self.aws, self.outputs, call=call, wait=wait, action=action)
        self.assertEqual(signals, [0, 1, 0])
        self.assertEqual(states, ['OK', 'ALARM', 'OK'])
        self.assertEqual(actions, ['ALARM', 'OK'])
        self.assertIn('does not prove email delivery', report['emailReceipt'])

    def test_alarm_timeout_or_notification_failure_always_attempts_reset(self):
        for stage in ['alarm', 'action']:
            signals = []
            def call(_aws, _fn, event): signals.append(event['signal'])
            def wait(_aws, _name, expected, _timeout):
                if stage == 'alarm' and expected == 'ALARM': raise RuntimeError('timeout')
                return {'StateValue': expected}
            def action(*_args): raise RuntimeError('SNS action failed')
            with self.assertRaises(RuntimeError):
                monitoring.exercise(self.aws, self.outputs, call=call, wait=wait, action=action)
            self.assertEqual(signals, [0, 1, 0])

    def test_action_evidence_rejects_old_transitions_other_topics_and_supports_epoch_milliseconds(self):
        alarm = {'StateUpdatedTimestamp': '2026-09-08T10:00:00+00:00'}
        for timestamp in [alarm['StateUpdatedTimestamp'], monitoring.stamp(alarm['StateUpdatedTimestamp']) * 1000]:
            data = {'actionState': 'Succeeded', 'notificationResource': self.outputs['AlertTopicArn'], 'stateUpdateTimestamp': timestamp}
            self.assertEqual(monitoring.matching_action({'HistoryData': json.dumps(data)}, alarm, self.outputs['AlertTopicArn']), 'Succeeded')
            self.assertIsNone(monitoring.matching_action({'HistoryData': json.dumps(data)}, alarm, 'different-topic'))
        data['stateUpdateTimestamp'] -= 60000
        self.assertIsNone(monitoring.matching_action({'HistoryData': json.dumps(data)}, alarm, self.outputs['AlertTopicArn']))
        alarm['StateTransitionedTimestamp'] = '2026-09-08T09:59:00+00:00'
        self.assertEqual(monitoring.matching_action({'HistoryData': json.dumps(data)}, alarm, self.outputs['AlertTopicArn']), 'Succeeded')

    def test_waits_have_deadlines_and_disabled_actions_are_not_reported_as_success(self):
        clock = [0]
        def aws(*_args): return {'MetricAlarms': [{'StateValue': 'OK', 'ActionsEnabled': True}]}
        def sleep(seconds): clock[0] += seconds
        with self.assertRaisesRegex(RuntimeError, 'Timed out'):
            monitoring.wait_for_alarm(aws, 'fixture', 'ALARM', 20, sleep=sleep, clock=lambda: clock[0])
        with self.assertRaisesRegex(RuntimeError, 'disabled'):
            monitoring.alarm_status(lambda *_args: {'MetricAlarms': [{'ActionsEnabled': False}]}, 'fixture')

    def test_pending_subscription_cannot_be_reported_as_confirmed(self):
        def aws(*_args): return {'Subscriptions': [{'Protocol': 'email', 'SubscriptionArn': 'PendingConfirmation'}]}
        self.assertEqual(monitoring.subscriptions(aws, self.outputs), 0)
        with self.assertRaisesRegex(RuntimeError, 'No confirmed'):
            monitoring.exercise(aws, self.outputs)


if __name__ == '__main__':
    unittest.main()
